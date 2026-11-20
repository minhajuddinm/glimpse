import { z } from 'zod'
import { SourceSchema } from './transcript'

/**
 * recording: transcript lines are being saved now.
 * summarizing: the meeting ended and the minutes are being written.
 * done: minutes are ready. error: writing the minutes failed (retry from the Meetings tab).
 * interrupted: Glimpse quit or crashed while recording; the transcript up to then is kept.
 */
export const MeetingStatusSchema = z.enum(['recording', 'summarizing', 'done', 'error', 'interrupted'])
export type MeetingStatus = z.infer<typeof MeetingStatusSchema>

export const MeetingSummarySchema = z.object({
  id: z.number().int(),
  title: z.string(),
  startedAt: z.number(),
  endedAt: z.number().nullable(),
  status: MeetingStatusSchema,
  lines: z.number().int(),
  /** Words spoken, both sides. */
  words: z.number().int(),
  /** First lines of the minutes' summary, for the list. */
  preview: z.string()
})
export type MeetingSummary = z.infer<typeof MeetingSummarySchema>

export const MeetingLineSchema = z.object({
  source: SourceSchema,
  text: z.string(),
  at: z.number()
})
export type MeetingLine = z.infer<typeof MeetingLineSchema>

export const MeetingDetailSchema = MeetingSummarySchema.extend({
  /** Markdown, or null until written. */
  minutes: z.string().nullable(),
  error: z.string().nullable(),
  /** Which model wrote the minutes. */
  model: z.string().nullable(),
  /** The Markdown file written to the notes folder, if any. */
  file: z.string().nullable(),
  transcript: z.array(MeetingLineSchema)
})
export type MeetingDetail = z.infer<typeof MeetingDetailSchema>

export const MeetingStateSchema = z.object({
  /** The meeting being recorded now, or null. */
  active: MeetingSummarySchema.nullable(),
  /** Ids whose minutes are being written. */
  summarizing: z.array(z.number().int())
})
export type MeetingState = z.infer<typeof MeetingStateSchema>

export const MEETING_TITLE_MAX = 200

/** "Meeting · Thu 20 Nov, 14:05" when the user gives no title. */
export function defaultMeetingTitle(at: number): string {
  const date = new Date(at)
  const day = date.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })
  const time = date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
  return `Meeting · ${day}, ${time}`
}

export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000))
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const seconds = total % 60
  const pad = (value: number): string => String(value).padStart(2, '0')
  return hours > 0 ? `${String(hours)}:${pad(minutes)}:${pad(seconds)}` : `${String(minutes)}:${pad(seconds)}`
}
