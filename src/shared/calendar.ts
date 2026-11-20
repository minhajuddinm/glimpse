import { z } from 'zod'

export const CalendarAttendeeSchema = z.object({ name: z.string(), email: z.string() })
export type CalendarAttendee = z.infer<typeof CalendarAttendeeSchema>

export const CalendarEventSchema = z.object({
  /** UID plus the occurrence start, so each repeat of a series is distinct. */
  id: z.string(),
  title: z.string(),
  start: z.number(),
  end: z.number(),
  allDay: z.boolean(),
  location: z.string(),
  /** Plain text, trimmed. */
  description: z.string(),
  attendees: z.array(CalendarAttendeeSchema),
  /** Zoom / Meet / Teams / Webex link found in the event, if any. */
  link: z.string().nullable()
})
export type CalendarEvent = z.infer<typeof CalendarEventSchema>

export const CalendarStatusSchema = z.object({
  /** A calendar address is saved. */
  connected: z.boolean(),
  state: z.enum(['off', 'syncing', 'ok', 'error']),
  message: z.string(),
  lastSyncAt: z.number().nullable(),
  /** Events in progress and those starting in the next 24 hours, soonest first. */
  events: z.array(CalendarEventSchema)
})
export type CalendarStatus = z.infer<typeof CalendarStatusSchema>

/**
 * A meeting with other people, as opposed to a focus block or a reminder: it has
 * at least one other attendee or a video-call link. Only these start recording on their own.
 */
export function isRealMeeting(event: CalendarEvent): boolean {
  return !event.allDay && (event.attendees.length >= 2 || event.link !== null)
}
