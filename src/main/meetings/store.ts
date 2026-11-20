import { z } from 'zod'
import type { MeetingDetail, MeetingLine, MeetingStatus, MeetingSummary } from '../../shared/meetings'
import { MeetingStatusSchema } from '../../shared/meetings'
import { SourceSchema, type Source } from '../../shared/transcript'
import { transaction, type Db } from '../db'

const MeetingRowSchema = z.object({
  id: z.number().int(),
  title: z.string(),
  started_at: z.number(),
  ended_at: z.number().nullable(),
  status: MeetingStatusSchema,
  minutes: z.string().nullable(),
  error: z.string().nullable(),
  model: z.string().nullable(),
  file: z.string().nullable(),
  lines: z.number().int(),
  words: z.number().int()
})
type MeetingRow = z.infer<typeof MeetingRowSchema>

const LineRowSchema = z.object({ source: SourceSchema, text: z.string(), at: z.number() })

const SELECT = `SELECT m.id, m.title, m.started_at, m.ended_at, m.status, m.minutes, m.error, m.model, m.file,
  (SELECT COUNT(*) FROM meeting_lines l WHERE l.meeting_id = m.id) AS lines,
  m.words AS words
  FROM meetings m`

function wordCount(text: string): number {
  return text.split(/\s+/).filter((word) => word.length > 0).length
}

/** The opening of the minutes' summary section, plain text, for the meeting list. */
export function minutesPreview(minutes: string | null, max = 160): string {
  if (minutes === null) return ''
  const body = minutes
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#'))
    .map((line) => line.replace(/^[-*]\s+(\[[ x]\]\s+)?/, '').replace(/\*\*/g, ''))
    .join(' ')
  return body.length > max ? `${body.slice(0, max - 1).trimEnd()}…` : body
}

function toSummary(row: MeetingRow): MeetingSummary {
  return {
    id: row.id,
    title: row.title,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    status: row.status,
    lines: row.lines,
    words: row.words,
    preview: minutesPreview(row.minutes)
  }
}

/** Meetings and their transcripts, in the app's SQLite database. Lines are saved as they arrive. */
export class MeetingStore {
  constructor(private readonly db: Db) {}

  create(title: string, startedAt: number): number {
    const result = this.db
      .prepare("INSERT INTO meetings (title, started_at, status, words) VALUES (?, ?, 'recording', 0)")
      .run(title, startedAt)
    return Number(result.lastInsertRowid)
  }

  addLine(meetingId: number, source: Source, text: string, at: number): void {
    transaction(this.db, () => {
      this.db.prepare('INSERT INTO meeting_lines (meeting_id, source, text, at) VALUES (?, ?, ?, ?)').run(meetingId, source, text, at)
      this.db.prepare('UPDATE meetings SET words = words + ? WHERE id = ?').run(wordCount(text), meetingId)
    })
  }

  end(meetingId: number, endedAt: number, status: MeetingStatus): void {
    this.db.prepare('UPDATE meetings SET ended_at = ?, status = ? WHERE id = ?').run(endedAt, status, meetingId)
  }

  setStatus(meetingId: number, status: MeetingStatus, error: string | null = null): void {
    this.db.prepare('UPDATE meetings SET status = ?, error = ? WHERE id = ?').run(status, error, meetingId)
  }

  saveMinutes(meetingId: number, minutes: string, model: string): void {
    this.db.prepare("UPDATE meetings SET minutes = ?, model = ?, status = 'done', error = NULL WHERE id = ?").run(minutes, model, meetingId)
  }

  setFile(meetingId: number, file: string | null): void {
    this.db.prepare('UPDATE meetings SET file = ? WHERE id = ?').run(file, meetingId)
  }

  rename(meetingId: number, title: string): void {
    this.db.prepare('UPDATE meetings SET title = ? WHERE id = ?').run(title, meetingId)
  }

  delete(meetingId: number): void {
    // meeting_lines go with it (ON DELETE CASCADE).
    this.db.prepare('DELETE FROM meetings WHERE id = ?').run(meetingId)
  }

  /** Meetings left "recording" (or "summarizing") by a crash or a forced quit become "interrupted"; returns how many. */
  recoverInterrupted(now: number): number {
    const rows = z
      .array(z.object({ id: z.number().int(), ended: z.number().nullable(), last: z.number().nullable(), minutes: z.number().int() }))
      .parse(
        this.db
          .prepare(
            `SELECT m.id, m.ended_at AS ended, (SELECT MAX(at) FROM meeting_lines l WHERE l.meeting_id = m.id) AS last,
              (m.minutes IS NOT NULL) AS minutes FROM meetings m WHERE m.status IN ('recording', 'summarizing')`
          )
          .all()
      )
    // A meeting that was already writing its minutes keeps its real end time, and a rewrite cut short keeps the earlier minutes.
    for (const row of rows) this.end(row.id, row.ended ?? row.last ?? now, row.minutes === 1 ? 'done' : 'interrupted')
    return rows.length
  }

  /** Notes files saved for every meeting except `meetingId`. */
  otherFiles(meetingId: number): string[] {
    return z
      .array(z.object({ file: z.string() }))
      .parse(this.db.prepare('SELECT file FROM meetings WHERE file IS NOT NULL AND id != ?').all(meetingId))
      .map((row) => row.file)
  }

  list(limit = 200): MeetingSummary[] {
    return z.array(MeetingRowSchema).parse(this.db.prepare(`${SELECT} ORDER BY m.started_at DESC LIMIT ?`).all(limit)).map(toSummary)
  }

  summary(meetingId: number): MeetingSummary | null {
    const row = MeetingRowSchema.safeParse(this.db.prepare(`${SELECT} WHERE m.id = ?`).get(meetingId))
    return row.success ? toSummary(row.data) : null
  }

  lines(meetingId: number): MeetingLine[] {
    return z.array(LineRowSchema).parse(this.db.prepare('SELECT source, text, at FROM meeting_lines WHERE meeting_id = ? ORDER BY id').all(meetingId))
  }

  detail(meetingId: number): MeetingDetail | null {
    const parsed = MeetingRowSchema.safeParse(this.db.prepare(`${SELECT} WHERE m.id = ?`).get(meetingId))
    if (!parsed.success) return null
    const row = parsed.data
    return { ...toSummary(row), minutes: row.minutes, error: row.error, model: row.model, file: row.file, transcript: this.lines(meetingId) }
  }
}
