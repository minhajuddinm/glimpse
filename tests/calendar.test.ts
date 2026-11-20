import { describe, expect, it } from 'vitest'
import { findMeetingLink, normalizeCalendarUrl, parseCalendar, plainText } from '../src/main/calendar/ics'
import { isRealMeeting } from '../src/shared/calendar'

/** A Google-style secret-address feed: Toronto time zone, a weekly series with one moved and one cancelled repeat. */
const FEED = [
  'BEGIN:VCALENDAR',
  'VERSION:2.0',
  'PRODID:-//Google Inc//Google Calendar 70.9054//EN',
  'BEGIN:VTIMEZONE',
  'TZID:America/Toronto',
  'BEGIN:DAYLIGHT',
  'TZOFFSETFROM:-0500',
  'TZOFFSETTO:-0400',
  'TZNAME:EDT',
  'DTSTART:19700308T020000',
  'RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=2SU',
  'END:DAYLIGHT',
  'BEGIN:STANDARD',
  'TZOFFSETFROM:-0400',
  'TZOFFSETTO:-0500',
  'TZNAME:EST',
  'DTSTART:19701101T020000',
  'RRULE:FREQ=YEARLY;BYMONTH=11;BYDAY=1SU',
  'END:STANDARD',
  'END:VTIMEZONE',
  // Weekly stand-up, Mondays 10:00 Toronto, with a Meet link and two guests.
  'BEGIN:VEVENT',
  'DTSTART;TZID=America/Toronto:20260105T100000',
  'DTEND;TZID=America/Toronto:20260105T103000',
  'RRULE:FREQ=WEEKLY;BYDAY=MO',
  'EXDATE;TZID=America/Toronto:20261130T100000',
  'UID:standup@google.com',
  'SUMMARY:Team stand-up',
  'X-GOOGLE-CONFERENCE:https://meet.google.com/abc-defg-hij',
  'ORGANIZER;CN=Sam Lee:mailto:sam@example.com',
  'ATTENDEE;CN=Sam Lee;PARTSTAT=ACCEPTED:mailto:sam@example.com',
  'ATTENDEE;CN=you@example.com;PARTSTAT=ACCEPTED:mailto:you@example.com',
  'ATTENDEE;CN=Ana Ruiz;PARTSTAT=DECLINED:mailto:ana@example.com',
  'END:VEVENT',
  // The 23 Nov repeat moved to 14:00.
  'BEGIN:VEVENT',
  'RECURRENCE-ID;TZID=America/Toronto:20261123T100000',
  'DTSTART;TZID=America/Toronto:20261123T140000',
  'DTEND;TZID=America/Toronto:20261123T143000',
  'UID:standup@google.com',
  'SUMMARY:Team stand-up (moved)',
  'END:VEVENT',
  // A one-off client call with an HTML description containing a Zoom link.
  'BEGIN:VEVENT',
  'DTSTART:20261123T190000Z',
  'DTEND:20261123T200000Z',
  'UID:acme@google.com',
  'SUMMARY:Acme pricing call',
  'DESCRIPTION:Agenda:<br>1. Pricing<br>2. Pilot &amp\\; timeline<br>Join: <a href="https://acme.zoom.us/j/123456789?pwd=x">https://acme.zoom.us/j/123456789?pwd=x</a>',
  'LOCATION:',
  'ATTENDEE;CN=Priya Shah:mailto:priya@acme.com',
  'ATTENDEE;CN=you@example.com:mailto:you@example.com',
  'END:VEVENT',
  // A cancelled event and an all-day reminder.
  'BEGIN:VEVENT',
  'DTSTART:20261123T150000Z',
  'DTEND:20261123T160000Z',
  'UID:cancelled@google.com',
  'STATUS:CANCELLED',
  'SUMMARY:Cancelled sync',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'DTSTART;VALUE=DATE:20261123',
  'DTEND;VALUE=DATE:20261124',
  'UID:allday@google.com',
  'SUMMARY:Focus day',
  'END:VEVENT',
  'END:VCALENDAR'
].join('\r\n')

const day = (iso: string): number => Date.parse(iso)

describe('parseCalendar', () => {
  it('expands the series, applies the moved repeat, skips cancelled ones, converts time zones', () => {
    const events = parseCalendar(FEED, day('2026-11-23T00:00:00Z'), day('2026-11-24T06:00:00Z'))
    const titles = events.map((event) => event.title)
    expect(titles).toContain('Team stand-up (moved)')
    expect(titles).not.toContain('Team stand-up')
    expect(titles).not.toContain('Cancelled sync')
    const moved = events.find((event) => event.title === 'Team stand-up (moved)')
    // 14:00 in Toronto (EST, UTC-5) is 19:00 UTC.
    expect(moved?.start).toBe(day('2026-11-23T19:00:00Z'))
    expect(moved?.end).toBe(day('2026-11-23T19:30:00Z'))
  })

  it('reads a regular repeat in daylight-saving time correctly', () => {
    const events = parseCalendar(FEED, day('2026-06-01T00:00:00Z'), day('2026-06-02T00:00:00Z'))
    const standup = events.find((event) => event.title === 'Team stand-up')
    // 10:00 EDT (UTC-4) is 14:00 UTC.
    expect(standup?.start).toBe(day('2026-06-01T14:00:00Z'))
    expect(standup?.link).toBe('https://meet.google.com/abc-defg-hij')
    // Declined attendees are left out; an email used as a name is not a name.
    expect(standup?.attendees).toEqual([
      { name: 'Sam Lee', email: 'sam@example.com' },
      { name: '', email: 'you@example.com' }
    ])
  })

  it('honours EXDATE (a skipped repeat)', () => {
    const events = parseCalendar(FEED, day('2026-11-30T00:00:00Z'), day('2026-12-01T00:00:00Z'))
    expect(events.some((event) => event.title.startsWith('Team stand-up'))).toBe(false)
  })

  it('cleans HTML descriptions and finds the Zoom link', () => {
    const events = parseCalendar(FEED, day('2026-11-23T18:00:00Z'), day('2026-11-23T21:00:00Z'))
    const acme = events.find((event) => event.title === 'Acme pricing call')
    expect(acme?.description).toContain('1. Pricing\n2. Pilot & timeline')
    expect(acme?.description).not.toContain('<')
    expect(acme?.link).toBe('https://acme.zoom.us/j/123456789?pwd=x')
    expect(acme !== undefined && isRealMeeting(acme)).toBe(true)
  })

  it('marks all-day events, which never count as meetings', () => {
    const events = parseCalendar(FEED, day('2026-11-23T12:00:00Z'), day('2026-11-23T13:00:00Z'))
    const focus = events.find((event) => event.title === 'Focus day')
    expect(focus?.allDay).toBe(true)
    expect(focus !== undefined && isRealMeeting(focus)).toBe(false)
  })

  it('gives each repeat its own id and sorts by start', () => {
    const events = parseCalendar(FEED, day('2026-01-01T00:00:00Z'), day('2026-02-01T00:00:00Z'))
    const ids = events.map((event) => event.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(events.length).toBe(4)
    expect([...events].sort((a, b) => a.start - b.start)).toEqual(events)
  })
})

describe('calendar helpers', () => {
  it('accepts https and webcal addresses only', () => {
    expect(normalizeCalendarUrl(' webcal://calendar.google.com/calendar/ical/x/private-abc/basic.ics ')).toBe(
      'https://calendar.google.com/calendar/ical/x/private-abc/basic.ics'
    )
    expect(() => normalizeCalendarUrl('http://example.com/cal.ics')).toThrow(/https/)
    expect(() => normalizeCalendarUrl('file:///C:/cal.ics')).toThrow()
    expect(() => normalizeCalendarUrl('not a url')).toThrow()
  })

  it('finds Teams and Webex links and ignores other URLs', () => {
    expect(findMeetingLink('See https://example.com/agenda', 'https://teams.microsoft.com/l/meetup-join/19%3ameeting_x')).toBe(
      'https://teams.microsoft.com/l/meetup-join/19%3ameeting_x'
    )
    expect(findMeetingLink('https://acme.webex.com/meet/pat')).toBe('https://acme.webex.com/meet/pat')
    expect(findMeetingLink('https://example.com')).toBeNull()
  })

  it('strips tags and entities', () => {
    expect(plainText('<p>Hi&nbsp;<b>there</b></p><div>x &lt; y</div>')).toBe('Hi there\nx < y')
  })
})

describe('parseCalendar edge cases', () => {
  const wrap = (...lines: string[]): string => ['BEGIN:VCALENDAR', 'VERSION:2.0', ...lines, 'END:VCALENDAR'].join('\r\n')
  const event = (...lines: string[]): string[] => ['BEGIN:VEVENT', ...lines, 'END:VEVENT']
  const from = day('2026-11-23T00:00:00Z')
  const to = day('2026-11-25T00:00:00Z')

  it('reads a calendar holding a series that has ended (COUNT, UNTIL)', () => {
    const events = parseCalendar(
      wrap(
        ...event('UID:count', 'DTSTART:20261120T150000Z', 'DTEND:20261120T160000Z', 'RRULE:FREQ=DAILY;COUNT=4', 'SUMMARY:Count'),
        ...event('UID:until', 'DTSTART:20261120T170000Z', 'DTEND:20261120T180000Z', 'RRULE:FREQ=DAILY;UNTIL=20261123T170000Z', 'SUMMARY:Until'),
        ...event('UID:old', 'DTSTART:20250101T090000Z', 'DTEND:20250101T100000Z', 'RRULE:FREQ=WEEKLY;COUNT=3', 'SUMMARY:Long over'),
        ...event('UID:one', 'DTSTART:20261124T150000Z', 'DTEND:20261124T160000Z', 'SUMMARY:One-off')
      ),
      from,
      to
    )
    expect(events.map((item) => item.title)).toEqual(['Count', 'Until', 'One-off'])
  })

  it('keeps the next repeats when one is moved past the window, and finds one moved into it', () => {
    const events = parseCalendar(
      wrap(
        ...event('UID:daily', 'DTSTART:20261101T150000Z', 'DTEND:20261101T160000Z', 'RRULE:FREQ=DAILY', 'SUMMARY:Daily'),
        ...event('UID:daily', 'RECURRENCE-ID:20261123T150000Z', 'DTSTART:20261201T150000Z', 'DTEND:20261201T160000Z', 'SUMMARY:Daily (moved out)'),
        ...event('UID:weekly', 'DTSTART:20261101T150000Z', 'DTEND:20261101T160000Z', 'RRULE:FREQ=WEEKLY', 'SUMMARY:Weekly'),
        ...event('UID:weekly', 'RECURRENCE-ID:20261129T150000Z', 'DTSTART:20261124T090000Z', 'DTEND:20261124T100000Z', 'SUMMARY:Weekly (moved in)')
      ),
      from,
      to
    )
    expect(events.map((item) => `${item.title} ${new Date(item.start).toISOString()}`)).toEqual([
      'Weekly (moved in) 2026-11-24T09:00:00.000Z',
      'Daily 2026-11-24T15:00:00.000Z'
    ])
  })

  it('converts a time zone the feed names but does not define (Outlook, or IANA without VTIMEZONE)', () => {
    for (const tzid of ['Tokyo Standard Time', 'Asia/Tokyo', '/mozilla.org/20050126_1/Asia/Tokyo']) {
      const [only] = parseCalendar(wrap(...event('UID:tz', `DTSTART;TZID=${tzid}:20261124T150000`, `DTEND;TZID=${tzid}:20261124T160000`, 'SUMMARY:Tokyo')), from, to)
      expect(only?.start).toBe(day('2026-11-24T06:00:00Z'))
      expect(only?.end).toBe(day('2026-11-24T07:00:00Z'))
    }
    // Repeats too, and across a daylight-saving change (New York: EDT until 1 Nov, then EST).
    const repeats = parseCalendar(
      wrap(...event('UID:ny', 'DTSTART;TZID=Eastern Standard Time:20261030T100000', 'DTEND;TZID=Eastern Standard Time:20261030T103000', 'RRULE:FREQ=DAILY;COUNT=4', 'SUMMARY:NY')),
      day('2026-10-30T00:00:00Z'),
      day('2026-11-03T00:00:00Z')
    )
    expect(repeats.map((item) => new Date(item.start).toISOString())).toEqual([
      '2026-10-30T14:00:00.000Z',
      '2026-10-31T14:00:00.000Z',
      '2026-11-01T15:00:00.000Z',
      '2026-11-02T15:00:00.000Z'
    ])
  })

  it('skips a broken event instead of failing the whole calendar, and keeps events sharing or missing a UID', () => {
    const events = parseCalendar(
      wrap(
        ...event('UID:broken', 'RRULE:FREQ=DAILY', 'SUMMARY:No start'),
        ...event('UID:dup', 'DTSTART:20261123T150000Z', 'DTEND:20261123T160000Z', 'SUMMARY:First'),
        ...event('UID:dup', 'DTSTART:20261124T150000Z', 'DTEND:20261124T160000Z', 'SUMMARY:Second'),
        ...event('UID:dup', 'DTSTART:20261124T150000Z', 'DTEND:20261124T160000Z', 'SUMMARY:Second'),
        ...event('DTSTART:20261124T170000Z', 'DTEND:20261124T180000Z', 'SUMMARY:No UID a'),
        ...event('DTSTART:20261124T170000Z', 'DTEND:20261124T180000Z', 'SUMMARY:No UID b')
      ),
      from,
      to
    )
    expect(events.map((item) => item.title)).toEqual(['First', 'Second', 'No UID a', 'No UID b'])
  })

  it('rejects something that is not a calendar with a readable message', () => {
    expect(() => parseCalendar('<html><body>BEGIN:VCALENDAR</body></html>', from, to)).toThrow(/not a valid iCalendar/)
    expect(() => parseCalendar('BEGIN:VCALENDAR\r\nnonsense\r\nEND:VCALENDAR', from, to)).toThrow(/not a valid iCalendar/)
  })

  it('keeps all-day events at local midnight', () => {
    const [allDay] = parseCalendar(wrap(...event('UID:ad', 'DTSTART;VALUE=DATE:20261124', 'SUMMARY:Holiday')), from, to)
    expect(allDay?.allDay).toBe(true)
    expect(allDay?.start).toBe(new Date(2026, 10, 24).getTime())
    expect(allDay?.end).toBe(new Date(2026, 10, 25).getTime())
  })
})

describe('normalizeCalendarUrl', () => {
  it('never repeats the address in its error (Electron logs failing IPC handlers)', () => {
    const attempt = (input: string): unknown => {
      try {
        normalizeCalendarUrl(input)
        return null
      } catch (error) {
        return error
      }
    }
    for (const input of ['calendar.google.com/calendar/ical/me/private-SECRET123/basic.ics', 'http://x/private-SECRET123', 'javascript:alert(1)//SECRET123']) {
      const error = attempt(input)
      expect(error).toBeInstanceOf(Error)
      expect(JSON.stringify(error)).not.toContain('SECRET123')
      expect(String(error)).not.toContain('SECRET123')
      expect(Object.values(error as object).join(' ')).not.toContain('SECRET123')
    }
  })
})
