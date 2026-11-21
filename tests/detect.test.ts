import { describe, expect, it } from 'vitest'
import { callAppOf, callInTitle, JOIN_CONFIRM_MS, MeetingDetector, parseMicUsage, POLL_MS, STOP_GRACE_MS, type MicUse } from '../src/main/meetings/detect'
import type { CalendarEvent } from '../src/shared/calendar'

const ZOOM = 'C:#Users#me#AppData#Roaming#Zoom#bin#Zoom.exe'
const CHROME = 'C:#Program Files#Google#Chrome#Application#chrome.exe'
const TEAMS = 'MSTeams_8wekyb3d8bbwe'
const OBS = 'D:#OBS#obs-studio#bin#64bit#obs64.exe'

describe('reading Windows’ microphone record', () => {
  it('parses reg query output: a stop time of 0 means in use now', () => {
    const output = [
      '',
      'HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\CapabilityAccessManager\\ConsentStore\\microphone\\MSTeams_8wekyb3d8bbwe',
      '    LastUsedTimeStop    REG_QWORD    0x0',
      '',
      'HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\CapabilityAccessManager\\ConsentStore\\microphone\\NonPackaged\\C:#Users#me#AppData#Roaming#Zoom#bin#Zoom.exe',
      '    LastUsedTimeStop    REG_QWORD    0x1dd3a4c1153f906',
      '',
      'End of search: 2 match(es) found.'
    ].join('\r\n')
    expect(parseMicUsage(output)).toEqual([
      { key: TEAMS, inUse: true },
      { key: ZOOM, inUse: false }
    ])
  })

  it('knows call apps and browsers, and ignores everything else', () => {
    expect(callAppOf(ZOOM)?.name).toBe('Zoom')
    expect(callAppOf(TEAMS)?.name).toBe('Teams')
    expect(callAppOf(CHROME)?.browser).toBe(true)
    expect(callAppOf(OBS)).toBeNull()
    expect(callAppOf('D:#Projects#Glimpse#Glimpse.exe')).toBeNull()
  })

  it('finds the call service in a browser title', () => {
    expect(callInTitle('Meet - abc-defg-hij - Google Chrome')).toBe('Google Meet')
    expect(callInTitle('Meeting with Priya | Microsoft Teams - Brave')).toBe('Teams')
    expect(callInTitle('Zoom Meeting - Google Chrome')).toBe('Zoom')
    expect(callInTitle('Inbox (3) - Gmail - Google Chrome')).toBeNull()
    expect(callInTitle('Zoom out on a map - Google Chrome')).toBeNull()
  })
})

function setup(options: { titles?: string[]; event?: CalendarEvent | null; running?: string[] } = {}) {
  let now = 0
  let mic: MicUse[] = []
  let active: number | null = null
  let nextId = 1
  let titles = options.titles ?? []
  const log: string[] = []
  const detector = new MeetingDetector({
    enabled: () => true,
    micUsage: () => Promise.resolve(mic),
    runningImages: () => Promise.resolve(new Set(options.running ?? ['zoom.exe', 'ms-teams.exe'])),
    windowTitles: () => Promise.resolve(titles),
    calendarEvent: () => options.event ?? null,
    activeMeeting: () => active,
    startMeeting: (title) => {
      active = nextId++
      log.push(`start:${title}`)
      return active
    },
    stopMeeting: () => {
      active = null
      log.push('stop')
    },
    notify: (title) => log.push(`notify:${title}`),
    now: () => now
  })
  /** Advances time by `ms`, polling every POLL_MS on the way. */
  const run = async (ms: number): Promise<void> => {
    const end = now + ms
    while (now < end) {
      now = Math.min(end, now + POLL_MS)
      await detector.poll()
    }
  }
  return {
    log,
    run,
    starts: () => log.filter((entry) => entry.startsWith('start') || entry === 'stop'),
    use: (...keys: string[]) => {
      mic = keys.map((key) => ({ key, inUse: true }))
    },
    setActive: (value: boolean) => {
      active = value ? nextId++ : null
    },
    setTitles: (value: string[]) => {
      titles = value
    }
  }
}

describe('MeetingDetector', () => {
  it('records when you join a Zoom call and stops when you leave', async () => {
    const t = setup()
    await t.run(30_000)
    expect(t.log).toEqual([])
    t.use(ZOOM)
    await t.run(JOIN_CONFIRM_MS + 2 * POLL_MS)
    expect(t.starts()).toEqual(['start:Zoom call'])
    await t.run(10 * 60_000)
    t.use()
    await t.run(STOP_GRACE_MS - POLL_MS)
    expect(t.starts()).toEqual(['start:Zoom call'])
    await t.run(2 * POLL_MS)
    expect(t.starts()).toEqual(['start:Zoom call', 'stop'])
    expect(t.log).toContain('notify:Call ended')
  })

  it('ignores a quick mic test, and other apps using the mic', async () => {
    const t = setup()
    t.use(ZOOM)
    await t.run(POLL_MS)
    t.use(OBS)
    await t.run(60_000)
    expect(t.log).toEqual([])
  })

  it('keeps recording through a short drop (a device switch)', async () => {
    const t = setup()
    t.use(TEAMS)
    await t.run(JOIN_CONFIRM_MS + 2 * POLL_MS)
    t.use()
    await t.run(2 * POLL_MS)
    t.use(TEAMS)
    await t.run(STOP_GRACE_MS * 2)
    expect(t.starts()).toEqual(['start:Teams call'])
  })

  it('records a browser only on a call tab', async () => {
    const t = setup({ titles: ['YouTube - Google Chrome'] })
    t.use(CHROME)
    await t.run(30_000)
    expect(t.log).toEqual([])
    t.setTitles(['Meet - abc-defg-hij - Google Chrome'])
    await t.run(30_000)
    expect(t.starts()).toEqual(['start:Google Meet call'])
  })

  it('names the recording after the calendar meeting, which also vouches for a browser call', async () => {
    const event: CalendarEvent = {
      id: 'e',
      title: 'Acme pricing call',
      start: 0,
      end: 3600_000,
      allDay: false,
      location: '',
      description: '',
      attendees: [],
      link: 'https://meet.google.com/abc-defg-hij'
    }
    const t = setup({ event })
    t.use(CHROME)
    await t.run(JOIN_CONFIRM_MS + 2 * POLL_MS)
    expect(t.starts()).toEqual(['start:Acme pricing call'])
  })

  it('does not restart a call you stopped recording, until the next call', async () => {
    const t = setup()
    t.use(ZOOM)
    await t.run(JOIN_CONFIRM_MS + 2 * POLL_MS)
    t.setActive(false) // You pressed stop.
    await t.run(5 * 60_000)
    expect(t.starts()).toEqual(['start:Zoom call'])
    t.use()
    await t.run(POLL_MS)
    t.use(ZOOM) // The next call.
    await t.run(JOIN_CONFIRM_MS + 2 * POLL_MS)
    expect(t.starts()).toEqual(['start:Zoom call', 'start:Zoom call'])
  })

  it('leaves a meeting you started yourself alone', async () => {
    const t = setup()
    t.setActive(true)
    t.use(ZOOM)
    await t.run(60_000)
    t.use()
    await t.run(60_000)
    expect(t.log).toEqual([])
  })

  it('ignores a stale record from a call app that is no longer running', async () => {
    const t = setup({ running: [] })
    t.use(ZOOM)
    await t.run(60_000)
    expect(t.log).toEqual([])
  })
})
