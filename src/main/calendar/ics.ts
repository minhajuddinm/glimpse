import ICAL from 'ical.js'
import type { CalendarAttendee, CalendarEvent } from '../../shared/calendar'

/** Safety cap on repeats expanded per series: expansion starts at the first occurrence, so a daily series from years ago needs a few thousand. */
const MAX_OCCURRENCES_PER_SERIES = 20_000
const MAX_DESCRIPTION = 2000

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

function toEvent(item: ICAL.Event, start: ICAL.Time, end: ICAL.Time): CalendarEvent | null {
  const status = stringProp(item.component, 'status').toUpperCase()
  if (status === 'CANCELLED') return null
  // ical.js types these as strings, but they are null when the property is missing.
  const description = plainText(stringProp(item.component, 'description'))
  const location = stringProp(item.component, 'location')
  const summary = stringProp(item.component, 'summary').trim()
  const conference = stringProp(item.component, 'x-google-conference')
  return {
    id: `${item.uid}@${String(start.toUnixTime())}`,
    title: summary === '' ? '(No title)' : summary,
    start: start.toJSDate().getTime(),
    end: end.toJSDate().getTime(),
    allDay: start.isDate,
    location,
    description: description.length > MAX_DESCRIPTION ? `${description.slice(0, MAX_DESCRIPTION - 1)}…` : description,
    attendees: attendeesOf(item),
    link: findMeetingLink(conference, location, description)
  }
}

/**
 * Parses an iCalendar feed (Google, Outlook, iCloud "secret address") into the events that
 * overlap [from, to): repeating meetings are expanded, moved or cancelled repeats honoured,
 * and times converted with the feed's own time-zone definitions.
 */
export function parseCalendar(ics: string, from: number, to: number): CalendarEvent[] {
  const root = ICAL.Component.fromString(ics)
  for (const zone of root.getAllSubcomponents('vtimezone')) ICAL.TimezoneService.register(zone)

  const masters = new Map<string, ICAL.Event>()
  const exceptions: ICAL.Event[] = []
  for (const component of root.getAllSubcomponents('vevent')) {
    const event = new ICAL.Event(component)
    if (event.isRecurrenceException()) exceptions.push(event)
    else masters.set(event.uid, event)
  }
  for (const exception of exceptions) {
    const master = masters.get(exception.uid)
    if (master !== undefined) master.relateException(exception)
  }

  const out: CalendarEvent[] = []
  const overlaps = (event: CalendarEvent): boolean => event.end > from && event.start < to

  for (const master of masters.values()) {
    if (!master.isRecurring()) {
      const event = toEvent(master, master.startDate, master.endDate)
      if (event !== null && overlaps(event)) out.push(event)
      continue
    }
    const iterator = master.iterator()
    for (let count = 0; count < MAX_OCCURRENCES_PER_SERIES; count++) {
      // Typed as always returning a Time, but it returns null when the series ends.
      const next = iterator.next() as ICAL.Time | null
      if (next === null) break
      const details = master.getOccurrenceDetails(next)
      const occurrenceStart = details.startDate.toJSDate().getTime()
      if (occurrenceStart >= to) break
      const event = toEvent(details.item, details.startDate, details.endDate)
      if (event !== null && overlaps(event)) out.push(event)
    }
  }

  // Exceptions whose series is not in the feed (rare) still count on their own.
  for (const exception of exceptions) {
    if (masters.has(exception.uid)) continue
    const event = toEvent(exception, exception.startDate, exception.endDate)
    if (event !== null && overlaps(event)) out.push(event)
  }

  return out.sort((a, b) => a.start - b.start || a.title.localeCompare(b.title))
}

/** webcal:// is https:// for our purposes; anything else must be https. */
export function normalizeCalendarUrl(input: string): string {
  const trimmed = input.trim()
  const url = new URL(trimmed.replace(/^webcals?:\/\//i, 'https://'))
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
