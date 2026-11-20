import ICAL from 'ical.js'
import type { CalendarAttendee, CalendarEvent } from '../../shared/calendar'
import { resolveZone, zonedTime } from './zones'

/** Safety cap on repeats expanded per series: expansion starts at the first occurrence, so a daily series from years ago needs a few thousand. */
const MAX_OCCURRENCES_PER_SERIES = 20_000
const MAX_DESCRIPTION = 2000
const DAY_MS = 24 * 3600_000
const NOT_A_CALENDAR = 'The calendar feed could not be read: it is not a valid iCalendar file.'

const LINK = /https:\/\/(?:[\w-]+\.)?(?:zoom\.us\/(?:j|my|w)\/|meet\.google\.com\/|teams\.microsoft\.com\/l\/meetup-join\/|teams\.live\.com\/meet\/|[\w-]+\.webex\.com\/)[^\s<>"')\]]+/i

/** Google and Outlook put HTML in descriptions; keep readable text only. */
export function plainText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

export function findMeetingLink(...texts: readonly string[]): string | null {
  for (const text of texts) {
    const match = LINK.exec(text)
    if (match !== null) return match[0]
  }
  return null
}

function attendeesOf(event: ICAL.Event): CalendarAttendee[] {
  const out: CalendarAttendee[] = []
  for (const property of event.attendees) {
    const value = property.getFirstValue()
    const email = typeof value === 'string' ? value.replace(/^mailto:/i, '') : ''
    const cn = property.getParameter('cn')
    const name = typeof cn === 'string' && cn.trim() !== '' && !cn.includes('@') ? cn.trim() : ''
    const partstat = property.getParameter('partstat')
    if (typeof partstat === 'string' && partstat.toUpperCase() === 'DECLINED') continue
    if (email === '' && name === '') continue
    out.push({ name, email })
  }
  return out
}

function stringProp(component: ICAL.Component, name: string): string {
  const value = component.getFirstPropertyValue(name)
  return typeof value === 'string' ? value : ''
}

/** ical.js types uid as a string, but it is null when the property is missing. */
function uidOf(event: ICAL.Event): string | null {
  const uid: unknown = event.uid
  return typeof uid === 'string' && uid !== '' ? uid : null
}

function tzidOf(component: ICAL.Component, name: string): string | null {
  const tzid = component.getFirstProperty(name)?.getParameter('tzid')
  return typeof tzid === 'string' && tzid !== '' ? tzid : null
}

/**
 * The instant a time denotes. A TZID the feed does not define (Outlook's "Eastern Standard
 * Time", or an IANA name without its VTIMEZONE) leaves ical.js on the PC's local time, so it
 * is resolved with the system's zone data instead. All-day dates stay at local midnight.
 */
function instant(time: ICAL.Time, tzid: string | null): number {
  if (tzid !== null && !time.isDate && time.zone === ICAL.Timezone.localTimezone) {
    const zone = resolveZone(tzid)
    const at = zone === null ? null : zonedTime(zone, time.year, time.month, time.day, time.hour, time.minute, time.second)
    if (at !== null) return at
  }
  return time.toJSDate().getTime()
}

function toEvent(item: ICAL.Event, start: ICAL.Time, end: ICAL.Time): CalendarEvent | null {
  const status = stringProp(item.component, 'status').toUpperCase()
  if (status === 'CANCELLED') return null
  // ical.js types these as strings, but they are null when the property is missing.
  const description = plainText(stringProp(item.component, 'description'))
  const location = stringProp(item.component, 'location')
  const summary = stringProp(item.component, 'summary').trim()
  const conference = stringProp(item.component, 'x-google-conference')
  const startTzid = tzidOf(item.component, 'dtstart')
  const startAt = instant(start, startTzid)
  return {
    id: `${uidOf(item) ?? `no-uid:${summary}`}@${String(Math.floor(startAt / 1000))}`,
    title: summary === '' ? '(No title)' : summary,
    start: startAt,
    end: Math.max(startAt, instant(end, tzidOf(item.component, 'dtend') ?? startTzid)),
    allDay: start.isDate,
    location,
    description: description.length > MAX_DESCRIPTION ? `${description.slice(0, MAX_DESCRIPTION - 1)}…` : description,
    attendees: attendeesOf(item),
    link: findMeetingLink(conference, location, description)
  }
}

/** Expands one repeating series into the occurrences overlapping [from, to). */
function expandSeries(master: ICAL.Event, exceptions: readonly ICAL.Event[], from: number, to: number, out: CalendarEvent[]): void {
  const overlaps = (event: CalendarEvent | null): event is CalendarEvent => event !== null && event.end > from && event.start < to
  // A repeat ending this long before the window cannot reach it, even shifted by a time zone,
  // so old repeats of a long series are skipped without building them...
  const length = Math.max(0, master.endDate.toJSDate().getTime() - master.startDate.toJSDate().getTime())
  const skipBefore = from - 2 * DAY_MS - length
  // ...unless one was moved into the window.
  const movedFrom = new Set(exceptions.map((exception) => exception.recurrenceId.toJSDate().getTime()))
  const iterator = master.iterator()
  let stoppedAt: ICAL.Time | null = null
  for (let count = 0; count < MAX_OCCURRENCES_PER_SERIES; count++) {
    // Typed as always returning a Time, but it returns undefined once the series ends (COUNT, UNTIL).
    const next: unknown = iterator.next()
    if (!(next instanceof ICAL.Time)) break
    const original = next.toJSDate().getTime()
    // Stop on the original time, not the moved one: a repeat moved past the window must not hide the next ones.
    if (original >= to + DAY_MS) {
      stoppedAt = next
      break
    }
    if (original < skipBefore && !movedFrom.has(original)) continue
    const details = master.getOccurrenceDetails(next)
    const event = toEvent(details.item, details.startDate, details.endDate)
    if (overlaps(event)) out.push(event)
  }
  if (stoppedAt === null) return
  // A later repeat moved back into the window.
  for (const exception of exceptions) {
    if (exception.recurrenceId.compare(stoppedAt) < 0) continue
    const event = toEvent(exception, exception.startDate, exception.endDate)
    if (overlaps(event)) out.push(event)
  }
}

function readFeed(ics: string): ICAL.Component {
  let root: ICAL.Component
  try {
    root = ICAL.Component.fromString(ics)
  } catch {
    // ical.js messages quote the offending line; ours does not need to.
    throw new Error(NOT_A_CALENDAR)
  }
  if (root.name !== 'vcalendar') throw new Error(NOT_A_CALENDAR)
  return root
}

/**
 * Parses an iCalendar feed (Google, Outlook, iCloud "secret address") into the events that
 * overlap [from, to): repeating meetings are expanded, moved or cancelled repeats honoured,
 * and times converted with the feed's own time-zone definitions. A broken event is skipped
 * rather than sinking the whole calendar.
 */
export function parseCalendar(ics: string, from: number, to: number): CalendarEvent[] {
  const root = readFeed(ics)
  for (const zone of root.getAllSubcomponents('vtimezone')) ICAL.TimezoneService.register(zone)

  const masters = new Map<string, ICAL.Event>()
  /** Events without a UID, or sharing one with an earlier event: kept, but not part of a series. */
  const loose: ICAL.Event[] = []
  const exceptions: ICAL.Event[] = []
  for (const component of root.getAllSubcomponents('vevent')) {
    const event = new ICAL.Event(component)
    const uid = uidOf(event)
    if (uid === null) loose.push(event)
    else if (event.isRecurrenceException()) exceptions.push(event)
    else if (masters.has(uid)) loose.push(event)
    else masters.set(uid, event)
  }
  const exceptionsOf = new Map<string, ICAL.Event[]>()
  for (const exception of exceptions) {
    const master = masters.get(exception.uid)
    if (master === undefined) {
      // Exceptions whose series is not in the feed (rare) still count on their own.
      loose.push(exception)
      continue
    }
    master.relateException(exception)
    exceptionsOf.set(exception.uid, [...(exceptionsOf.get(exception.uid) ?? []), exception])
  }

  const out: CalendarEvent[] = []
  for (const item of [...masters.values(), ...loose]) {
    try {
      if (item.isRecurring() && !item.isRecurrenceException()) {
        expandSeries(item, exceptionsOf.get(item.uid) ?? [], from, to, out)
        continue
      }
      const event = toEvent(item, item.startDate, item.endDate)
      if (event !== null && event.end > from && event.start < to) out.push(event)
    } catch {
      // No DTSTART, an impossible rule: skip this event, keep the rest of the calendar.
    }
  }

  // The same event listed twice (a duplicated invite) is shown once.
  const unique = new Map<string, CalendarEvent>()
  for (const event of out) if (!unique.has(event.id)) unique.set(event.id, event)
  return [...unique.values()].sort((a, b) => a.start - b.start || a.title.localeCompare(b.title))
}

/** webcal:// is https:// for our purposes; anything else must be https. */
export function normalizeCalendarUrl(input: string): string {
  const trimmed = input.trim()
  let url: URL
  try {
    url = new URL(trimmed.replace(/^webcals?:\/\//i, 'https://'))
  } catch {
    // Node's error carries the input, and Electron logs a failing IPC handler's error: keep the secret out of it.
    throw new Error('That is not a web address. Copy the whole https:// (or webcal://) address of the calendar.')
  }
  if (url.protocol !== 'https:') throw new Error('Use the https:// (or webcal://) address of the calendar.')
  return url.toString()
}

/** The invite as plain text for the meeting brief prompt. */
export function inviteText(event: CalendarEvent, now: number): string {
  const time = (at: number): string => new Date(at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
  const day = new Date(event.start).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })
  const minutes = Math.round((event.start - now) / 60_000)
  const people = event.attendees.map((person) => (person.name !== '' ? `${person.name} <${person.email}>` : person.email)).join(', ')
  return [
    `Title: ${event.title}`,
    `When: ${day}, ${time(event.start)}–${time(event.end)}${minutes > 0 ? ` (in ${String(minutes)} min)` : ''}`,
    people !== '' ? `With: ${people}` : '',
    event.location !== '' ? `Location: ${event.location}` : '',
    event.description !== '' ? `Description:\n${event.description}` : ''
  ]
    .filter((line) => line !== '')
    .join('\n')
}
