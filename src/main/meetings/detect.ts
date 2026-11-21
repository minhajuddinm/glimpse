import { execFile } from 'node:child_process'
import { isRealMeeting, type CalendarEvent } from '../../shared/calendar'

/** How often the microphone is checked while auto-recording is on. */
export const POLL_MS = 3000
/** A call app must hold the mic this long before recording starts (a quick mic test does not count). */
export const JOIN_CONFIRM_MS = 5000
/** After the call app lets go of the mic, wait this long before stopping (a device switch, a reconnect). */
export const STOP_GRACE_MS = 20_000
/** While recording, check this often that the call app is still running (a crash can leave Windows' record stale). */
const ALIVE_CHECK_MS = 60_000
/** While a browser holds the mic without a call tab in front, look at its window titles again this often. */
const TITLE_RECHECK_MS = 10_000

/** Windows' record of which apps use the microphone: the same data behind the taskbar's mic icon. */
const MIC_KEY = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\CapabilityAccessManager\\ConsentStore\\microphone'

/** One app in Windows' microphone record. `key` is the app's entry: a package family name, or the exe path with # for \. */
export interface MicUse {
  readonly key: string
  readonly inUse: boolean
}

export interface CallApp {
  readonly name: string
  /** A browser holds the mic for many reasons: it only counts with a call tab or a calendar call. */
  readonly browser: boolean
  /** Process image names, lower case, for the "still running" check. */
  readonly images: readonly string[]
}

interface AppRule extends CallApp {
  readonly packages: readonly string[]
}

const APPS: readonly AppRule[] = [
  { name: 'Zoom', browser: false, images: ['zoom.exe'], packages: [] },
  { name: 'Teams', browser: false, images: ['ms-teams.exe', 'teams.exe'], packages: ['msteams_', 'microsoftteams_'] },
  { name: 'Webex', browser: false, images: ['ciscocollabhost.exe', 'webex.exe', 'webexhost.exe', 'atmgr.exe'], packages: ['cisco.webex'] },
  { name: 'Slack', browser: false, images: ['slack.exe'], packages: ['com.tinyspeck.slackdesktop_'] },
  { name: 'Skype', browser: false, images: ['skype.exe'], packages: ['microsoft.skypeapp_'] },
  { name: 'GoTo Meeting', browser: false, images: ['g2mcomm.exe', 'goto.exe', 'gotomeeting.exe'], packages: [] },
  { name: 'RingCentral', browser: false, images: ['ringcentral.exe', 'ringcentralmeetings.exe'], packages: [] },
  ...['chrome.exe', 'msedge.exe', 'brave.exe', 'firefox.exe', 'opera.exe', 'vivaldi.exe', 'arc.exe'].map((image) => ({
    name: 'browser',
    browser: true,
    images: [image],
    packages: []
  }))
]

/** Which call app (if any) a microphone record entry belongs to. */
export function callAppOf(key: string): CallApp | null {
  const lower = key.toLowerCase()
  if (lower.includes('#')) {
    const image = lower.slice(lower.lastIndexOf('#') + 1)
    return APPS.find((app) => app.images.includes(image)) ?? null
  }
  return APPS.find((app) => app.packages.some((prefix) => lower.startsWith(prefix))) ?? null
}

/** Reads `reg query <MIC_KEY> /s /v LastUsedTimeStop`: a stop time of 0 means the app has the mic open now. */
export function parseMicUsage(output: string): MicUse[] {
  const out: MicUse[] = []
  let key: string | null = null
  for (const raw of output.split(/\r?\n/)) {
    const line = raw.trim()
    if (/^HKEY_/i.test(line)) {
      key = line.slice(line.lastIndexOf('\\') + 1)
      continue
    }
    const match = /^LastUsedTimeStop\s+REG_QWORD\s+0x([0-9a-f]+)$/i.exec(line)
    if (match?.[1] !== undefined && key !== null) {
      out.push({ key, inUse: /^0+$/.test(match[1]) })
      key = null
    }
  }
  return out
}

/** The call service a browser window title shows, if any. */
export function callInTitle(title: string): string | null {
  if (/^Meet\s*[-–—:]|Google Meet/i.test(title)) return 'Google Meet'
  if (/Microsoft Teams/i.test(title) && !/^(Chat|Activity|Calendar|Files)\b/i.test(title)) return 'Teams'
  if (/\bZoom\b/i.test(title) && /meeting|webinar|zoom\.us/i.test(title)) return 'Zoom'
  if (/\bWebex\b/i.test(title)) return 'Webex'
  if (/\bJitsi Meet\b/i.test(title)) return 'Jitsi'
  if (/\bWhereby\b/i.test(title)) return 'Whereby'
  return null
}

/** The call service of a calendar meeting link. */
export function callOfLink(link: string): string {
  const host = new URL(link).hostname
  if (host.endsWith('meet.google.com')) return 'Google Meet'
  if (host.includes('zoom.us')) return 'Zoom'
  if (host.includes('teams.')) return 'Teams'
  if (host.includes('webex.com')) return 'Webex'
  return 'online'
}

function run(file: string, args: readonly string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(file, args, { windowsHide: true, timeout: 5000, maxBuffer: 4 * 1024 * 1024 }, (error, stdout) => {
      if (error !== null) reject(new Error(`${file} failed: ${error.message}`))
      else resolve(stdout)
    })
  })
}

/** Rows of `tasklist /fo csv /nh`: quoted, comma separated. */
function csvRows(output: string): string[][] {
  return output
    .split(/\r?\n/)
    .filter((line) => line.startsWith('"'))
    .map((line) => line.slice(1, -1).split('","'))
}

/** The Windows side of detection: the mic record, running processes and browser window titles. */
export const windowsProbes = {
  micUsage: async (): Promise<MicUse[]> => parseMicUsage(await run('reg.exe', ['query', MIC_KEY, '/s', '/v', 'LastUsedTimeStop'])),
  runningImages: async (): Promise<Set<string>> => new Set(csvRows(await run('tasklist.exe', ['/fo', 'csv', '/nh'])).map((row) => (row[0] ?? '').toLowerCase())),
  windowTitles: async (image: string): Promise<string[]> =>
    csvRows(await run('tasklist.exe', ['/v', '/fo', 'csv', '/nh', '/fi', `imagename eq ${image}`]))
      .map((row) => row[row.length - 1] ?? '')
      .filter((title) => title !== '' && title !== 'N/A')
}

export interface MeetingDetectorOptions {
  /** The "record meetings I join" setting. */
  readonly enabled: () => boolean
  readonly micUsage: () => Promise<readonly MicUse[]>
  readonly runningImages: () => Promise<ReadonlySet<string>>
  readonly windowTitles: (image: string) => Promise<readonly string[]>
  /** The calendar meeting happening now (or about to), if any: names the recording and vouches for browser calls. */
  readonly calendarEvent: () => CalendarEvent | null
  /** The id of the meeting being recorded, or null. */
  readonly activeMeeting: () => number | null
  /** Starts recording; returns the new meeting's id. */
  readonly startMeeting: (title: string) => number | null
  readonly stopMeeting: () => void
  readonly notify: (title: string, body: string) => void
  readonly now: () => number
}

/**
 * Starts recording when you join a call and stops when you leave it. "Joined" means a
 * call app (Zoom, Teams, Webex, Slack, a browser on Meet/Teams/Zoom...) has opened the
 * microphone, as Windows records it for the taskbar's mic icon: a meeting on the calendar
 * that you do not join is never recorded.
 */
export class MeetingDetector {
  private timer: ReturnType<typeof setInterval> | null = null
  private polling = false
  /** A call app first seen holding the mic, waiting out JOIN_CONFIRM_MS. */
  private candidate: { readonly key: string; readonly since: number } | null = null
  /** The recording Glimpse started for a call, so it stops that one (and only that one). */
  private running: { readonly meetingId: number; readonly key: string; readonly app: string; lastSeen: number; aliveCheckedAt: number } | null = null
  /** Calls not to record: you stopped the recording, or were recording yourself. Forgotten when the call ends. */
  private readonly declined = new Set<string>()
  /** Browser mic sessions: the call service found in a title, or when titles were last checked. */
  private readonly browsers = new Map<string, { readonly call: string | null; readonly checkedAt: number }>()
  /** Mic records left open by an app that is not running (it crashed): looked at again after ALIVE_CHECK_MS. */
  private readonly stale = new Map<string, number>()

  constructor(private readonly options: MeetingDetectorOptions) {}

  start(): void {
    this.timer ??= setInterval(() => void this.poll(), POLL_MS)
  }

  stop(): void {
    if (this.timer !== null) clearInterval(this.timer)
    this.timer = null
  }

  /** One check. Public for tests; overlapping calls are skipped. */
  async poll(): Promise<void> {
    if (this.polling) return
    this.polling = true
    try {
      await this.check()
    } catch (error) {
      console.warn('[meetings] call detection failed:', error instanceof Error ? error.message : error)
    } finally {
      this.polling = false
    }
  }

  private async check(): Promise<void> {
    if (!this.options.enabled()) {
      // Turning it off leaves a running recording alone, but Glimpse no longer stops it.
      this.running = null
      this.candidate = null
      return
    }
    const now = this.options.now()
    const inUse = new Set((await this.options.micUsage()).filter((use) => use.inUse).map((use) => use.key))
    for (const key of this.declined) if (!inUse.has(key)) this.declined.delete(key)
    for (const key of this.browsers.keys()) if (!inUse.has(key)) this.browsers.delete(key)
    for (const [key, at] of this.stale) if (!inUse.has(key) || now - at >= ALIVE_CHECK_MS) this.stale.delete(key)

    if (this.running !== null) {
      await this.follow(this.running, inUse, now)
      return
    }

    const active = this.options.activeMeeting()
    const calls = [...inUse].flatMap((key) => {
      const app = callAppOf(key)
      return app === null ? [] : [{ key, app }]
    })
    if (active !== null) {
      // You are recording already: leave it alone, and do not start another one for this call later.
      for (const call of calls) this.declined.add(call.key)
      this.candidate = null
      return
    }

    let found: { readonly key: string; readonly app: string } | null = null
    for (const call of calls) {
      if (this.declined.has(call.key) || this.stale.has(call.key)) continue
      const name = call.app.browser ? await this.browserCall(call.key, call.app, now) : call.app.name
      if (name !== null) {
        found = { key: call.key, app: name }
        break
      }
    }
    if (found === null) {
      this.candidate = null
      return
    }
    if (this.candidate?.key !== found.key) {
      this.candidate = { key: found.key, since: now }
      return
    }
    if (now - this.candidate.since < JOIN_CONFIRM_MS) return
    this.candidate = null

    const app = callAppOf(found.key)
    // A crash can leave Windows saying the mic is still open: only a running app counts.
    if (app !== null && !app.browser && !(await this.isRunning(app))) {
      this.stale.set(found.key, now)
      return
    }

    const event = this.options.calendarEvent()
    const title = event !== null && isRealMeeting(event) ? event.title : `${found.app} call`
    const meetingId = this.options.startMeeting(title)
    if (meetingId === null) return
    this.running = { meetingId, key: found.key, app: found.app, lastSeen: now, aliveCheckedAt: now }
    this.options.notify(`Recording “${title}”`, `You joined a ${found.app} call, so Glimpse is transcribing it. Tell the others they are being recorded.`)
  }

  /** While recording a call: stop when it ends; forget it if you stopped or replaced the recording. */
  private async follow(running: NonNullable<MeetingDetector['running']>, inUse: ReadonlySet<string>, now: number): Promise<void> {
    if (this.options.activeMeeting() !== running.meetingId) {
      // You stopped it: do not record this call again until it ends.
      this.declined.add(running.key)
      this.running = null
      return
    }
    let ended = false
    if (inUse.has(running.key)) {
      running.lastSeen = now
      const app = callAppOf(running.key)
      if (app !== null && !app.browser && now - running.aliveCheckedAt >= ALIVE_CHECK_MS) {
        running.aliveCheckedAt = now
        ended = !(await this.isRunning(app))
      }
    } else {
      ended = now - running.lastSeen >= STOP_GRACE_MS
    }
    if (!ended) return
    this.running = null
    this.options.stopMeeting()
    this.options.notify('Call ended', `Glimpse stopped recording your ${running.app} call and is writing the minutes.`)
  }

  /** Whether a browser holding the mic is on a call: a call tab in a window title, or a calendar call now. */
  private async browserCall(key: string, app: CallApp, now: number): Promise<string | null> {
    const known = this.browsers.get(key)
    if (known !== undefined && known.call !== null) return known.call
    const event = this.options.calendarEvent()
    if (event !== null && isRealMeeting(event) && event.link !== null) {
      const call = callOfLink(event.link)
      this.browsers.set(key, { call, checkedAt: now })
      return call
    }
    if (known !== undefined && now - known.checkedAt < TITLE_RECHECK_MS) return null
    const image = app.images[0] ?? ''
    const titles = await this.options.windowTitles(image).catch(() => [])
    const call = titles.map(callInTitle).find((name) => name !== null) ?? null
    this.browsers.set(key, { call, checkedAt: now })
    return call
  }

  private async isRunning(app: CallApp): Promise<boolean> {
    const images = await this.options.runningImages().catch(() => null)
    // If the process list cannot be read, trust the mic record.
    return images === null || app.images.some((image) => images.has(image))
  }
}
