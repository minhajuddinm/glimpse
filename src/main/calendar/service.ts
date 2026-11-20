import { isRealMeeting, type CalendarEvent, type CalendarStatus } from '../../shared/calendar'
import { parseCalendar } from './ics'

export const SYNC_MS = 5 * 60_000
export const TICK_MS = 30_000
/** The brief appears this long before a meeting starts. */
export const BRIEF_LEAD_MS = 5 * 60_000
/** Auto-recording starts up to this long after the start (Glimpse launched late, PC woke up). */
export const LATE_START_MS = 10 * 60_000
/** An auto-started meeting is stopped this long after the calendar end, unless you stopped it already. */
export const OVERRUN_MS = 10 * 60_000
/** "Start meeting" with no title borrows the title of a meeting starting this soon. */
const TITLE_LEAD_MS = 10 * 60_000
const MAX_FEED_BYTES = 10 * 1024 * 1024
const MESSAGE_OFF = 'Not connected. Paste your calendar’s secret iCal address to turn it on.'

export interface CalendarServiceOptions {
  /** The saved (decrypted) feed address, or null. */
  readonly url: () => string | null
  readonly fetchText: (url: string) => Promise<string>
  readonly now: () => number
  readonly settings: () => { readonly calendarBrief: boolean; readonly calendarAutoStart: boolean }
  /** The id of the meeting being recorded, or null. */
  readonly activeMeeting: () => number | null
  /** Starts recording; returns the new meeting's id. */
  readonly startMeeting: (title: string) => number | null
  readonly stopMeeting: () => void
  readonly onBrief: (event: CalendarEvent) => void
  readonly notify: (title: string, body: string) => void
  readonly onStatus: (status: CalendarStatus) => void
}

/** Downloads a feed with a timeout and a size cap. Error messages never include the (secret) address. */
export async function fetchFeed(url: string): Promise<string> {
  // The low-level error is dropped on purpose: its details can name the address.
  const response = await fetch(url, { signal: AbortSignal.timeout(20_000), redirect: 'follow', headers: { Accept: 'text/calendar' } }).catch((error: unknown) => {
    const timedOut = error instanceof Error && error.name === 'TimeoutError'
    return new Error(timedOut ? 'The calendar server did not answer in time.' : 'Could not reach the calendar server. Check the internet connection.')
  })
  if (response instanceof Error) throw response
  if (!response.ok) {
    throw new Error(response.status === 404 || response.status === 403 ? 'The calendar address was not found. It may have been reset: copy it again.' : `The calendar server answered ${String(response.status)}.`)
  }
  const declared = Number(response.headers.get('content-length') ?? '0')
  if (declared > MAX_FEED_BYTES) throw new Error('The calendar feed is too large (over 10 MB).')
  const text = await response.text()
  if (text.length > MAX_FEED_BYTES) throw new Error('The calendar feed is too large (over 10 MB).')
  if (!text.includes('BEGIN:VCALENDAR')) throw new Error('That address did not return a calendar. Use the “secret address in iCal format”.')
  return text
}

/**
 * Reads the user's calendar from its private iCal address (read-only, no sign-in), shows
 * what is coming up, prepares a brief before each meeting and, if allowed, starts and
 * stops meeting recording with the calendar.
 */
export class CalendarService {
  private events: CalendarEvent[] = []
  /** The address `events` came from: another address must not show (or record) the old calendar. */
  private eventsUrl: string | null = null
  private state: CalendarStatus['state'] = 'off'
  private message = MESSAGE_OFF
  private lastSyncAt: number | null = null
  private timers: ReturnType<typeof setInterval>[] = []
  private syncing: Promise<void> | null = null
  private readonly briefed = new Set<string>()
  /** Events whose recording is settled: started by Glimpse, or already covered by your own meeting. */
  private readonly autoStarted = new Set<string>()
  /** The meeting Glimpse started for a calendar event, so it can stop it too (and only it). */
  private running: { readonly meetingId: number; readonly end: number } | null = null

  constructor(private readonly options: CalendarServiceOptions) {}

  start(): void {
    void this.refresh()
    this.timers = [
      setInterval(() => void this.refresh(), SYNC_MS),
      setInterval(() => {
        this.tick()
      }, TICK_MS)
    ]
  }

  stop(): void {
    for (const timer of this.timers) clearInterval(timer)
    this.timers = []
  }

  status(): CalendarStatus {
    const now = this.options.now()
    return {
      connected: this.options.url() !== null,
      state: this.state,
      message: this.message,
      lastSyncAt: this.lastSyncAt,
      events: this.events.filter((event) => event.end > now && event.start < now + 24 * 3600_000)
    }
  }

  /**
   * Re-reads the feed now (also after the address changes). Concurrent calls share one
   * download; one that finds the address changed meanwhile downloads again before resolving.
   */
  refresh(): Promise<void> {
    this.syncing ??= this.sync().finally(() => {
      this.syncing = null
    })
    return this.syncing
  }

  /** The meeting happening now, or starting within 10 minutes, for a default title. */
  currentEvent(): CalendarEvent | null {
    const now = this.options.now()
    const candidates = this.events.filter((event) => !event.allDay && event.start - TITLE_LEAD_MS <= now && now < event.end)
    return candidates.find(isRealMeeting) ?? candidates[0] ?? null
  }

  /** Every 30 s: the pre-meeting brief, and auto start/stop. Public for tests. */
  tick(): void {
    const now = this.options.now()
    const settings = this.options.settings()

    if (this.running !== null) {
      if (this.options.activeMeeting() !== this.running.meetingId) {
        this.running = null // Stopped by hand (and maybe another meeting started since: that one is yours).
      } else if (now >= this.running.end + OVERRUN_MS) {
        this.running = null
        this.options.stopMeeting()
        this.options.notify('Meeting recording stopped', 'The calendar meeting ended, so Glimpse stopped recording and is writing the minutes.')
      }
    }

    for (const event of this.events) {
      if (!isRealMeeting(event)) continue
      const untilStart = event.start - now

      if (settings.calendarBrief && untilStart > 0 && untilStart <= BRIEF_LEAD_MS && !this.briefed.has(event.id)) {
        this.briefed.add(event.id)
        this.options.onBrief(event)
        const minutes = Math.max(1, Math.round(untilStart / 60_000))
        this.options.notify(`${event.title} in ${String(minutes)} min`, 'Your brief is ready in the overlay.')
      }

      const inWindow = now >= event.start - 60_000 && now < Math.min(event.end, event.start + LATE_START_MS)
      if (!settings.calendarAutoStart || !inWindow || this.autoStarted.has(event.id)) continue
      if (this.options.activeMeeting() !== null) {
        if (this.running === null) {
          // You are already recording (say, with Record on this event): if you stop, it stays stopped.
          this.autoStarted.add(event.id)
          continue
        }
        // Glimpse's recording of the previous meeting: wait while that meeting is on, then hand over.
        if (now < this.running.end) continue
        this.running = null
        this.options.stopMeeting()
      }
      this.autoStarted.add(event.id)
      const meetingId = this.options.startMeeting(event.title)
      if (meetingId === null) continue
      this.running = { meetingId, end: event.end }
      this.options.notify(`Recording “${event.title}”`, 'Glimpse started the meeting from your calendar. Tell the others they are being transcribed.')
    }
  }

  private async sync(): Promise<void> {
    for (;;) {
      const url = this.options.url()
      if (url !== this.eventsUrl) {
        this.events = []
        this.eventsUrl = url
        this.lastSyncAt = null
      }
      if (url === null) {
        this.state = 'off'
        this.message = MESSAGE_OFF
        this.emit()
        return
      }
      this.state = 'syncing'
      this.emit()
      const now = this.options.now()
      let outcome: { readonly events: CalendarEvent[] } | { readonly error: string }
      try {
        const text = await this.options.fetchText(url)
        outcome = { events: parseCalendar(text, now - 12 * 3600_000, now + 36 * 3600_000) }
      } catch (error) {
        outcome = { error: error instanceof Error ? error.message : String(error) }
      }
      // The address was changed or removed while downloading: that result is for the old one.
      if (this.options.url() !== url) continue
      if ('events' in outcome) {
        this.events = outcome.events
        this.lastSyncAt = this.options.now()
        this.state = 'ok'
        const upcoming = this.status().events.length
        this.message = upcoming === 0 ? 'Connected. Nothing in the next 24 hours.' : `Connected. ${String(upcoming)} event${upcoming === 1 ? '' : 's'} in the next 24 hours.`
        this.tick()
      } else {
        // Keep the last good events: a dropped connection should not blank the list.
        this.state = 'error'
        this.message = outcome.error
      }
      this.emit()
      return
    }
  }

  private emit(): void {
    this.options.onStatus(this.status())
  }
}
