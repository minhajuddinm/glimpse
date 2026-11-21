import { describe, expect, it } from 'vitest'
import { buildPrompt } from '../src/main/answers/prompt'
import { inviteText } from '../src/main/calendar/ics'
import { BRIEF_LEAD_MS, CalendarService, fetchFeed } from '../src/main/calendar/service'
import type { CalendarEvent, CalendarStatus } from '../src/shared/calendar'

const T0 = Date.parse('2026-11-23T18:50:00Z')
const iso = (at: number): string => new Date(at).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')

function feed(events: readonly { uid: string; start: number; end: number; title: string; attendees?: number; link?: boolean }[]): string {
  const body = events.flatMap((event) => [
    'BEGIN:VEVENT',
    `UID:${event.uid}`,
    `DTSTART:${iso(event.start)}`,
    `DTEND:${iso(event.end)}`,
    `SUMMARY:${event.title}`,
    ...Array.from({ length: event.attendees ?? 0 }, (_, index) => `ATTENDEE;CN=Person ${String(index)}:mailto:p${String(index)}@example.com`),
    ...(event.link === true ? ['LOCATION:https://meet.google.com/abc-defg-hij'] : []),
    'END:VEVENT'
  ])
  return ['BEGIN:VCALENDAR', 'VERSION:2.0', ...body, 'END:VCALENDAR'].join('\r\n')
}

function setup(ics: string | Error, options: { brief?: boolean; url?: string | null } = {}) {
  let now = T0
  let url = options.url === undefined ? 'https://calendar.example/private.ics' : options.url
  let text: string | Error = ics
  let fetchText: (address: string) => Promise<string> = () => (text instanceof Error ? Promise.reject(text) : Promise.resolve(text))
  const log: string[] = []
  const statuses: CalendarStatus[] = []
  const service = new CalendarService({
    url: () => url,
    fetchText: (address) => fetchText(address),
    now: () => now,
    settings: () => ({ calendarBrief: options.brief ?? true }),
    onBrief: (event) => log.push(`brief:${event.title}`),
    notify: (title) => log.push(`notify:${title}`),
    onStatus: (status) => statuses.push(status)
  })
  return {
    service,
    log,
    statuses,
    at: (ms: number) => {
      now = ms
      service.tick()
    },
    setFeed: (value: string | Error) => {
      text = value
    },
    setUrl: (value: string | null) => {
      url = value
    },
    setFetch: (fetcher: (address: string) => Promise<string>) => {
      fetchText = fetcher
    }
  }
}

const CALL = { uid: 'call', start: T0 + 10 * 60_000, end: T0 + 40 * 60_000, title: 'Acme pricing call', attendees: 3 }
const FOCUS = { uid: 'focus', start: T0 + 5 * 60_000, end: T0 + 65 * 60_000, title: 'Focus time' }

describe('CalendarService', () => {
  it('lists upcoming events and says when it is not connected', async () => {
    const connected = setup(feed([CALL, FOCUS]))
    await connected.service.refresh()
    const status = connected.service.status()
    expect(status.state).toBe('ok')
    expect(status.events.map((event) => event.title)).toEqual(['Focus time', 'Acme pricing call'])
    expect(status.message).toMatch(/2 events/)

    const off = setup(feed([CALL]), { url: null })
    await off.service.refresh()
    expect(off.service.status()).toMatchObject({ connected: false, state: 'off', events: [] })
  })

  it('briefs once, five minutes before a meeting with people, never for a focus block', async () => {
    const { service, log, at } = setup(feed([CALL, FOCUS]))
    await service.refresh()
    at(CALL.start - BRIEF_LEAD_MS - 60_000)
    expect(log.filter((entry) => entry.startsWith('brief'))).toEqual([])
    at(CALL.start - BRIEF_LEAD_MS + 1000)
    at(CALL.start - 60_000)
    expect(log.filter((entry) => entry.startsWith('brief'))).toEqual(['brief:Acme pricing call'])
    expect(log).toContain('notify:Acme pricing call in 5 min')
  })

  it('does not brief when the setting is off', async () => {
    const { service, log, at } = setup(feed([CALL]), { brief: false })
    await service.refresh()
    at(CALL.start - 60_000)
    expect(log).toEqual([])
  })

  it('keeps the last good events when a sync fails', async () => {
    const { service, setFeed } = setup(feed([CALL]))
    await service.refresh()
    setFeed(new Error('fetch failed'))
    await service.refresh()
    expect(service.status()).toMatchObject({ state: 'error', message: 'fetch failed' })
    expect(service.status().events).toHaveLength(1)
  })

  it('names a meeting after the calendar event happening now', async () => {
    const { service, at } = setup(feed([FOCUS, CALL]))
    await service.refresh()
    at(CALL.start - 5 * 60_000)
    // Both are current; the one with people wins.
    expect(service.currentEvent()?.title).toBe('Acme pricing call')
  })
})

describe('meeting brief prompt', () => {
  const event: CalendarEvent = {
    id: 'x',
    title: 'Acme pricing call',
    start: T0 + 5 * 60_000,
    end: T0 + 35 * 60_000,
    allDay: false,
    location: '',
    description: 'Agenda: pricing',
    attendees: [{ name: 'Priya Shah', email: 'priya@acme.com' }],
    link: null
  }

  it('sends the invite, not the transcript', () => {
    const invite = inviteText(event, T0)
    expect(invite).toMatch(/^Title: Acme pricing call/)
    expect(invite).toContain('With: Priya Shah <priya@acme.com>')
    expect(invite).toContain('(in 5 min)')
    const prompt = buildPrompt({
      mode: 'general',
      kind: 'brief',
      context: '',
      transcript: { segments: [{ id: 1, source: 'them', text: 'unrelated chatter', at: T0, latencyMs: null }], partials: { them: '', you: '' } },
      trigger: invite,
      notes: []
    })
    expect(prompt.user).toContain('<meeting>')
    expect(prompt.user).not.toContain('unrelated chatter')
    expect(prompt.system).toContain('At most 90 words')
  })
})

describe('CalendarService: address changes', () => {
  it('does not keep showing the old calendar after the address changes and the new one fails', async () => {
    const { service, setUrl, setFeed } = setup(feed([CALL]))
    await service.refresh()
    expect(service.status().events).toHaveLength(1)
    setUrl('https://calendar.example/other.ics')
    setFeed(new Error('The calendar address was not found.'))
    await service.refresh()
    expect(service.status()).toMatchObject({ state: 'error', events: [], lastSyncAt: null })
  })

  it('downloads again when the address changes during a sync, and disconnecting mid-sync stays disconnected', async () => {
    const changed = setup(feed([CALL]))
    let release: (text: string) => void = () => undefined
    changed.setFetch((address) => (address.endsWith('private.ics') ? new Promise((resolve) => (release = resolve)) : Promise.resolve(feed([FOCUS]))))
    const first = changed.service.refresh()
    changed.setUrl('https://calendar.example/new.ics')
    const second = changed.service.refresh() // What calendar:set-url awaits.
    release(feed([CALL]))
    await Promise.all([first, second])
    expect(changed.service.status().events.map((event) => event.title)).toEqual(['Focus time'])

    const removed = setup(feed([CALL]))
    removed.setFetch(() => new Promise((resolve) => (release = resolve)))
    const pending = removed.service.refresh()
    removed.setUrl(null)
    const disconnect = removed.service.refresh()
    release(feed([CALL]))
    await Promise.all([pending, disconnect])
    expect(removed.service.status()).toMatchObject({ connected: false, state: 'off', events: [] })
    removed.at(CALL.start - 60_000)
    expect(removed.log).toEqual([])
  })
})

describe('fetchFeed', () => {
  it('never puts the address in its error messages', async () => {
    const secret = 'https://127.0.0.1:1/calendar/ical/me/private-SECRET123/basic.ics'
    const error = await fetchFeed(secret).then(
      () => null,
      (caught: unknown) => caught
    )
    expect(error).toBeInstanceOf(Error)
    expect(String(error)).not.toContain('SECRET123')
    expect(String(error)).toMatch(/calendar server/)
  })
})
