import { describe, expect, it, vi } from 'vitest'
import {
  callAppOf,
  callInTitle,
  callOfLink,
  JOIN_CONFIRM_MS,
  MeetingDetector,
  parseMicUsage,
  parseWindowTitles,
  POLL_MS,
  STOP_GRACE_MS,
  type MicUse
} from '../src/main/meetings/detect'
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
  let enabled = true
  let running = options.running ?? ['zoom.exe', 'ms-teams.exe', 'chrome.exe']
  let micError: Error | null = null
  /** Runs while a probe is "spawning", to act between the detector's checks. */
  let duringProbe: ((probe: 'mic' | 'processes' | 'titles') => void) | null = null
  const probes = { mic: 0, processes: 0, titles: 0 }
  const log: string[] = []
  const detector = new MeetingDetector({
    enabled: () => enabled,
    micUsage: () => {
      probes.mic++
      duringProbe?.('mic')
      return micError === null ? Promise.resolve(mic) : Promise.reject(micError)
    },
    runningImages: () => {
      probes.processes++
      duringProbe?.('processes')
      return Promise.resolve(new Set(running))
    },
    windowTitles: () => {
      probes.titles++
      duringProbe?.('titles')
      return Promise.resolve(titles)
    },
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
    detector,
    probes,
    active: () => active,
    setRunning: (value: string[]) => {
      running = value
    },
    setEnabled: (value: boolean) => {
      enabled = value
    },
    setMicError: (value: Error | null) => {
      micError = value
    },
    setDuringProbe: (value: ((probe: 'mic' | 'processes' | 'titles') => void) | null) => {
      duringProbe = value
    },
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

describe('call detection: parsers on real Windows output', () => {
  it('reads the real registry layout: packaged apps, the NonPackaged parent, paths with spaces', () => {
    const base = 'HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\CapabilityAccessManager\\ConsentStore\\microphone'
    const output = [
      '',
      `${base}\\Microsoft.WindowsSoundRecorder_8wekyb3d8bbwe`,
      '    LastUsedTimeStop    REG_QWORD    0x1db6923a2cf8036',
      '',
      `${base}\\NonPackaged`,
      '    LastUsedTimeStop    REG_QWORD    0x0',
      '',
      `${base}\\NonPackaged\\C:#Program Files (x86)#Microsoft#Edge#Application#msedge.exe`,
      '    LastUsedTimeStop    REG_QWORD    0X0',
      '',
      `${base}\\NonPackaged\\E:#A - Working Games#PEAK#PEAK.exe`,
      '\tLastUsedTimeStop\tREG_QWORD\t0x0',
      '',
      'Fin de la recherche : 3 correspondance(s) trouvée(s).'
    ].join('\r\n')
    expect(parseMicUsage(output)).toEqual([
      { key: 'Microsoft.WindowsSoundRecorder_8wekyb3d8bbwe', inUse: false },
      { key: 'NonPackaged', inUse: true },
      { key: 'C:#Program Files (x86)#Microsoft#Edge#Application#msedge.exe', inUse: true },
      { key: 'E:#A - Working Games#PEAK#PEAK.exe', inUse: true }
    ])
    expect(callAppOf('NonPackaged')).toBeNull()
    expect(callAppOf('C:#Program Files (x86)#Microsoft#Edge#Application#msedge.exe')?.browser).toBe(true)
  })

  it('never counts Glimpse itself, dev or installed', () => {
    expect(callAppOf('D:#Software#Glimpse#node_modules#electron#dist#electron.exe')).toBeNull()
    expect(callAppOf('C:#Users#me#AppData#Local#Programs#Glimpse#Glimpse.exe')).toBeNull()
  })

  it('reads window titles that contain quotes or "," (tasklist does not escape them)', () => {
    const row = (title: string): string => `"chrome.exe","1996","Console","1","7,108 K","Running","PC\\me","0:00:00","${title}"`
    const output = ['', row('Meet - a","b "q" c'), row('N/A'), row('Meet – abc-defg-hij — José'), 'INFO: something'].join('\r\n')
    expect(parseWindowTitles(output)).toEqual(['Meet - a","b "q" c', 'Meet – abc-defg-hij — José'])
  })

  it('finds calls in browser titles without false alarms', () => {
    expect(callInTitle('Meet – abc-defg-hij - Google Chrome')).toBe('Google Meet')
    expect(callInTitle('Google Meet - abc-defg-hij - Google Chrome')).toBe('Google Meet')
    expect(callInTitle('Google Meet - Google Chrome')).toBeNull() // Meet's home page
    expect(callInTitle('How to use Google Meet - YouTube - Google Chrome')).toBeNull()
    expect(callInTitle('Chat | Microsoft Teams - Google Chrome')).toBeNull()
    expect(callInTitle('(3) Chat | Microsoft Teams - Google Chrome')).toBeNull()
    expect(callInTitle('Calendar | Microsoft Teams - Microsoft Edge')).toBeNull()
    expect(callInTitle('Chat | Priya Sharma | Microsoft Teams - Microsoft Edge')).toBeNull()
    expect(callInTitle('Teams sync with Priya | Microsoft Teams - Microsoft Edge')).toBe('Teams')
    expect(callInTitle('Zoom Webinar - Google Chrome')).toBe('Zoom')
    expect(callInTitle('app.zoom.us - Google Chrome')).toBe('Zoom')
    expect(callInTitle('Meeting notes: zoom lens review - Google Docs - Google Chrome')).toBeNull()
  })

  it('names the call service of odd calendar links without throwing', () => {
    expect(callOfLink('https://us02web.ZOOM.us/j/123')).toBe('Zoom')
    expect(callOfLink('https://teams.live.com/meet/123')).toBe('Teams')
    expect(callOfLink('not a link')).toBe('online')
    expect(callOfLink('')).toBe('online')
  })
})

describe('MeetingDetector: edge cases', () => {
  it('does nothing at all while the setting is off: no reg.exe or tasklist', async () => {
    const t = setup()
    t.setEnabled(false)
    t.use(ZOOM, CHROME)
    await t.run(5 * 60_000)
    expect(t.probes).toEqual({ mic: 0, processes: 0, titles: 0 })
    expect(t.log).toEqual([])
  })

  it('keeps following its call when the setting is turned off and on again', async () => {
    const t = setup()
    t.use(ZOOM)
    await t.run(JOIN_CONFIRM_MS + 2 * POLL_MS)
    t.setEnabled(false)
    await t.run(60_000)
    t.setEnabled(true)
    await t.run(60_000)
    t.use()
    await t.run(STOP_GRACE_MS + POLL_MS)
    expect(t.starts()).toEqual(['start:Zoom call', 'stop'])
  })

  it('does not stop its recording while the setting is off', async () => {
    const t = setup()
    t.use(ZOOM)
    await t.run(JOIN_CONFIRM_MS + 2 * POLL_MS)
    t.setEnabled(false)
    t.use()
    await t.run(5 * 60_000)
    expect(t.starts()).toEqual(['start:Zoom call'])
  })

  it('does not take over a meeting you start while it is checking a browser tab', async () => {
    const t = setup({ titles: ['Meet - abc-defg-hij - Google Chrome'] })
    t.use(CHROME)
    await t.run(POLL_MS) // a candidate
    t.setDuringProbe((probe) => {
      if (probe !== 'mic' && t.active() === null) t.setActive(true) // you press "Start meeting" right now
    })
    await t.run(JOIN_CONFIRM_MS + POLL_MS)
    t.setDuringProbe(null)
    t.use()
    await t.run(5 * 60_000)
    expect(t.starts()).toEqual([])
    expect(t.active()).not.toBeNull()
  })

  it('does not stop a meeting you start while it checks that the call app is alive', async () => {
    const t = setup({ running: ['zoom.exe'] })
    t.use(ZOOM)
    await t.run(JOIN_CONFIRM_MS + 2 * POLL_MS)
    expect(t.starts()).toEqual(['start:Zoom call'])
    // Zoom crashes, leaving the mic record open. While Glimpse reads the process list, you stop its recording and start your own.
    t.setRunning([])
    t.setDuringProbe((probe) => {
      if (probe !== 'processes') return
      t.setActive(false)
      t.setActive(true)
    })
    await t.run(70_000)
    t.setDuringProbe(null)
    t.use()
    await t.run(60_000)
    expect(t.starts()).toEqual(['start:Zoom call'])
    expect(t.active()).not.toBeNull()
  })

  it('ignores a stale browser record during a calendar call when the browser is not running', async () => {
    const event: CalendarEvent = {
      id: 'e',
      title: 'Sync',
      start: 0,
      end: 3600_000,
      allDay: false,
      location: '',
      description: '',
      attendees: [],
      link: 'https://meet.google.com/abc-defg-hij'
    }
    const t = setup({ event, running: [] })
    t.use(CHROME)
    await t.run(3 * 60_000)
    expect(t.log).toEqual([])
  })

  it('records the second call app when the first call ends', async () => {
    const t = setup()
    t.use(ZOOM, TEAMS)
    await t.run(JOIN_CONFIRM_MS + 2 * POLL_MS)
    expect(t.starts()).toEqual(['start:Zoom call'])
    t.use(TEAMS)
    await t.run(STOP_GRACE_MS + JOIN_CONFIRM_MS + 3 * POLL_MS)
    expect(t.starts()).toEqual(['start:Zoom call', 'stop', 'start:Teams call'])
  })

  it('needs the mic held without a break: rapid flaps never start a recording', async () => {
    const t = setup()
    for (let i = 0; i < 20; i++) {
      t.use(ZOOM)
      await t.run(POLL_MS)
      t.use()
      await t.run(POLL_MS)
    }
    expect(t.log).toEqual([])
  })

  it('leaves your own meeting alone after you stop its recording mid-call, and does not restart', async () => {
    const t = setup()
    t.use(ZOOM)
    await t.run(JOIN_CONFIRM_MS + 2 * POLL_MS)
    t.setActive(false) // you stop it
    await t.run(POLL_MS)
    t.setActive(true) // and start your own
    await t.run(60_000)
    t.setActive(false) // and stop that one too
    await t.run(60_000)
    t.use()
    await t.run(60_000)
    expect(t.starts()).toEqual(['start:Zoom call'])
  })

  it('logs a failing reg.exe once, not every poll, and recovers', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const t = setup()
    t.setMicError(new Error('reg.exe failed: ERROR: The system was unable to find the specified registry key or value.'))
    await t.run(60_000)
    expect(warn).toHaveBeenCalledTimes(1)
    t.setMicError(null)
    t.use(ZOOM)
    await t.run(JOIN_CONFIRM_MS + 2 * POLL_MS)
    expect(t.starts()).toEqual(['start:Zoom call'])
    warn.mockRestore()
  })

  it('a check still running when Glimpse quits starts nothing', async () => {
    const t = setup()
    t.use(ZOOM)
    await t.run(JOIN_CONFIRM_MS)
    t.setDuringProbe((probe) => {
      if (probe === 'mic') t.detector.stop()
    })
    await t.run(2 * POLL_MS)
    expect(t.log).toEqual([])
  })
})
