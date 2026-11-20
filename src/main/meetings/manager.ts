import type { MeetingState, MeetingSummary } from '../../shared/meetings'
import { MEETING_TITLE_MAX, defaultMeetingTitle } from '../../shared/meetings'
import type { Segment } from '../../shared/transcript'
import type { LlmProvider } from '../answers/llm'
import {
  cleanMinutes,
  formatTranscript,
  mergeUserPrompt,
  minutesFile,
  minutesFileName,
  minutesSystemPrompt,
  minutesUserPrompt,
  partUserPrompt,
  splitTranscript
} from './minutes'
import type { MeetingStore } from './store'

/** Per-request transcript budget: Claude takes hours of talk at once; Groq's free tier allows ~8K tokens a minute. */
const PART_TOKENS: Record<LlmProvider['id'], number> = { anthropic: 120_000, groq: 4_500 }
const MAX_TOKENS = 3000
/** Below this a meeting is too short to be worth minutes (a mis-click, a test). */
export const MIN_WORDS_FOR_MINUTES = 25

export interface MeetingFiles {
  /** Writes the minutes into the notes folder; returns the path, or null if saving is off. */
  write(fileName: string, contents: string): Promise<string | null>
  remove(path: string): Promise<void>
}

export interface MeetingManagerOptions {
  readonly store: MeetingStore
  readonly provider: () => LlmProvider | null
  readonly context: () => string
  readonly files: MeetingFiles
  readonly now: () => number
  readonly onState: (state: MeetingState) => void
  readonly onListChanged: (list: MeetingSummary[]) => void
}

/**
 * Meeting sessions: while one is active, every finished transcript line is saved.
 * When it stops, the minutes are written by the answer provider (Sonnet with
 * Anthropic, gpt-oss with Groq) and saved to the notes folder as Markdown.
 */
export class MeetingManager {
  private activeId: number | null = null
  /** Minutes being written, by meeting id; a second request joins the one in flight. */
  private readonly summarizing = new Map<number, Promise<void>>()

  constructor(private readonly options: MeetingManagerOptions) {}

  /** Marks meetings a crash left open; call once at startup. */
  init(): void {
    this.options.store.recoverInterrupted(this.options.now())
  }

  get active(): boolean {
    return this.activeId !== null
  }

  state(): MeetingState {
    return {
      active: this.activeId === null ? null : this.options.store.summary(this.activeId),
      summarizing: [...this.summarizing.keys()]
    }
  }

  start(title = ''): MeetingState {
    if (this.activeId !== null) return this.state()
    const at = this.options.now()
    const name = title.trim().slice(0, MEETING_TITLE_MAX) || defaultMeetingTitle(at)
    this.activeId = this.options.store.create(name, at)
    this.emit()
    return this.state()
  }

  /** Ends the active meeting and starts writing its minutes in the background. */
  stop(): MeetingState {
    const id = this.activeId
    if (id === null) return this.state()
    this.activeId = null
    const summary = this.options.store.summary(id)
    if (summary !== null && summary.words < MIN_WORDS_FOR_MINUTES) {
      this.options.store.end(id, this.options.now(), 'error')
      this.options.store.setStatus(id, 'error', 'Too little was said to write minutes. The transcript is kept.')
      this.emit()
      return this.state()
    }
    this.options.store.end(id, this.options.now(), 'summarizing')
    void this.summarize(id)
    return this.state()
  }

  /** On quit: there is no time to write minutes, so the meeting is kept as "interrupted" for later. */
  shutdown(): void {
    if (this.activeId === null) return
    this.options.store.end(this.activeId, this.options.now(), 'interrupted')
    this.activeId = null
  }

  toggle(title = ''): MeetingState {
    return this.activeId === null ? this.start(title) : this.stop()
  }

  /** Each finished transcript line from the audio pipeline. */
  onSegment(segment: Segment): void {
    if (this.activeId === null) return
    this.options.store.addLine(this.activeId, segment.source, segment.text, segment.at)
    this.emitState()
  }

  rename(id: number, title: string): void {
    const name = title.trim().slice(0, MEETING_TITLE_MAX)
    if (name === '') throw new Error('A meeting needs a title.')
    this.options.store.rename(id, name)
    this.emit()
  }

  async delete(id: number): Promise<void> {
    if (id === this.activeId) throw new Error('Stop the meeting before deleting it.')
    const detail = this.options.store.detail(id)
    this.options.store.delete(id)
    if (detail?.file !== null && detail?.file !== undefined) await this.options.files.remove(detail.file).catch(() => undefined)
    this.emit()
  }

  /** Writes (or rewrites) the minutes for a finished meeting. Resolves when done; never throws. */
  summarize(id: number): Promise<void> {
    if (id === this.activeId) return Promise.resolve()
    const running = this.summarizing.get(id)
    if (running !== undefined) return running
    const job = this.writeMinutes(id).finally(() => {
      this.summarizing.delete(id)
      this.emit()
    })
    this.summarizing.set(id, job)
    return job
  }

  private async writeMinutes(id: number): Promise<void> {
    const detail = this.options.store.detail(id)
    if (detail === null) return
    const provider = this.options.provider()
    if (provider === null) {
      this.options.store.setStatus(id, 'error', 'Add an Anthropic or Groq key in Answers to write minutes. The transcript is saved.')
      this.emit()
      return
    }
    if (detail.transcript.length === 0) {
      this.options.store.setStatus(id, 'error', 'Nothing was transcribed during this meeting.')
      this.emit()
      return
    }
    this.options.store.setStatus(id, 'summarizing')
    this.emit()
    try {
      const system = minutesSystemPrompt(this.options.context())
      const transcript = formatTranscript(detail.transcript, detail.startedAt)
      const parts = splitTranscript(transcript, PART_TOKENS[provider.id])
      const ask = (user: string): Promise<string> =>
        provider.stream({ system, user, maxTokens: MAX_TOKENS, deep: true }, () => undefined, new AbortController().signal)
      let raw: string
      if (parts.length === 1) {
        raw = await ask(minutesUserPrompt(detail.title, detail.startedAt, transcript))
      } else {
        const notes: string[] = []
        for (const [index, part] of parts.entries()) notes.push(cleanMinutes(await ask(partUserPrompt(index, parts.length, part))))
        raw = await ask(mergeUserPrompt(detail.title, detail.startedAt, notes))
      }
      const minutes = cleanMinutes(raw)
      this.options.store.saveMinutes(id, minutes, provider.model(true))
      await this.saveFile(id)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      console.error(`[meetings] minutes for ${String(id)} failed:`, message)
      this.options.store.setStatus(id, 'error', `Could not write the minutes: ${message}`)
    }
  }

  /** Writes the minutes into the notes folder, replacing the previous file for this meeting. */
  private async saveFile(id: number): Promise<void> {
    const detail = this.options.store.detail(id)
    if (detail?.minutes === null || detail?.minutes === undefined) return
    try {
      const contents = minutesFile(detail.title, detail.startedAt, detail.endedAt, detail.minutes)
      const path = await this.options.files.write(minutesFileName(detail.title, detail.startedAt), contents)
      if (detail.file !== null && detail.file !== path) await this.options.files.remove(detail.file).catch(() => undefined)
      this.options.store.setFile(id, path)
    } catch (error) {
      // The minutes are safe in the database; the file is a convenience.
      console.warn('[meetings] could not save the minutes file:', error)
    }
  }

  private emitState(): void {
    this.options.onState(this.state())
  }

  private emit(): void {
    this.emitState()
    this.options.onListChanged(this.options.store.list())
  }
}
