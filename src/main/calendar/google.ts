import { createHash, randomBytes } from 'node:crypto'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { z } from 'zod'
import type { CalendarAttendee, CalendarEvent } from '../../shared/calendar'
import { findMeetingLink, plainText } from './ics'

/** Read-only access to events: Glimpse never changes the calendar. */
export const GOOGLE_SCOPE = 'https://www.googleapis.com/auth/calendar.events.readonly'
const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth'
const TOKEN_URL = 'https://oauth2.googleapis.com/token'
const REVOKE_URL = 'https://oauth2.googleapis.com/revoke'
const EVENTS_URL = 'https://www.googleapis.com/calendar/v3/calendars/primary/events'
/** How long the browser sign-in may take. */
export const SIGN_IN_TIMEOUT_MS = 5 * 60_000
const MAX_PAGES = 5
const MAX_DESCRIPTION = 2000

export type Fetch = (url: string, init?: RequestInit) => Promise<Response>

/** The OAuth client the user creates in their own Google Cloud project (type "Desktop app"). */
export interface GoogleClient {
  readonly id: string
  readonly secret: string
}

export const GoogleClientSchema = z.object({ id: z.string().min(1), secret: z.string().min(1) })

/** Checks what was pasted from Google Cloud; returns the trimmed client, or throws a readable error. */
export function checkGoogleClient(id: string, secret: string): GoogleClient {
  const client = { id: id.trim(), secret: secret.trim() }
  if (!/^[\w-]+\.apps\.googleusercontent\.com$/.test(client.id)) {
    throw new Error('That is not a Google client ID: it ends in .apps.googleusercontent.com. Copy it from Google Cloud → Clients.')
  }
  if (client.secret === '' || /\s/.test(client.secret)) throw new Error('Paste the client secret too (it usually starts with GOCSPX-).')
  return client
}

const base64url = (bytes: Buffer): string => bytes.toString('base64url')

/** The consent page address: PKCE, a state check and offline access (a refresh token). */
export function authorizationUrl(client: GoogleClient, redirectUri: string, challenge: string, state: string): string {
  const params = new URLSearchParams({
    client_id: client.id,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: GOOGLE_SCOPE,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    state,
    access_type: 'offline',
    prompt: 'consent'
  })
  return `${AUTH_URL}?${params.toString()}`
}

const TokenSchema = z.object({ access_token: z.string(), expires_in: z.number(), refresh_token: z.string().optional() })
const TokenErrorSchema = z.object({ error: z.string(), error_description: z.string().optional() })
const ApiErrorSchema = z.object({
  error: z.object({ code: z.number().optional(), message: z.string().optional(), errors: z.array(z.object({ reason: z.string().optional() })).optional() })
})

const TimeSchema = z.object({ dateTime: z.string().optional(), date: z.string().optional() })
const GoogleEventSchema = z.object({
  id: z.string(),
  status: z.string().optional(),
  eventType: z.string().optional(),
  summary: z.string().optional(),
  description: z.string().optional(),
  location: z.string().optional(),
  start: TimeSchema.optional(),
  end: TimeSchema.optional(),
  hangoutLink: z.string().optional(),
  conferenceData: z
    .object({ entryPoints: z.array(z.object({ entryPointType: z.string().optional(), uri: z.string().optional() })).optional() })
    .optional(),
  attendees: z
    .array(
      z.object({
        email: z.string().optional(),
        displayName: z.string().optional(),
        self: z.boolean().optional(),
        resource: z.boolean().optional(),
        responseStatus: z.string().optional()
      })
    )
    .optional()
})
type GoogleEvent = z.infer<typeof GoogleEventSchema>
const EventsPageSchema = z.object({ items: z.array(z.unknown()).optional(), nextPageToken: z.string().optional() })

/** Google's "YYYY-MM-DD" (all-day) is a local date; a dateTime carries its own offset. */
function instant(time: z.infer<typeof TimeSchema> | undefined): { at: number; allDay: boolean } | null {
  if (time?.dateTime !== undefined) {
    const at = Date.parse(time.dateTime)
    return Number.isNaN(at) ? null : { at, allDay: false }
  }
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(time?.date ?? '')
  if (match === null) return null
  return { at: new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3])).getTime(), allDay: true }
}

/**
 * One event from the Calendar API, or null for what is not a meeting on your day: cancelled
 * events, ones you declined, and working-location markers. Rooms and people who declined are
 * left out of the attendees.
 */
export function fromGoogleEvent(item: GoogleEvent): CalendarEvent | null {
  if (item.status === 'cancelled' || item.eventType === 'workingLocation') return null
  const people = item.attendees ?? []
  if (people.some((person) => person.self === true && person.responseStatus === 'declined')) return null
  const start = instant(item.start)
  const end = instant(item.end)
  if (start === null) return null
  const description = plainText(item.description ?? '')
  const location = item.location ?? ''
  const attendees: CalendarAttendee[] = people
    .filter((person) => person.resource !== true && person.responseStatus !== 'declined')
    .map((person) => ({ name: person.displayName?.trim() ?? '', email: person.email ?? '' }))
    .filter((person) => person.name !== '' || person.email !== '')
  const video = item.conferenceData?.entryPoints?.find((entry) => entry.entryPointType === 'video')?.uri
  const summary = item.summary?.trim() ?? ''
  return {
    id: item.id,
    title: summary === '' ? '(No title)' : summary,
    start: start.at,
    end: Math.max(start.at, end?.at ?? start.at),
    allDay: start.allDay,
    location,
    description: description.length > MAX_DESCRIPTION ? `${description.slice(0, MAX_DESCRIPTION - 1)}…` : description,
    attendees,
    link: findMeetingLink(item.hangoutLink ?? '', video ?? '', location, description)
  }
}

/** A readable message for a failed Calendar API call. */
async function apiError(response: Response): Promise<Error> {
  const parsed = ApiErrorSchema.safeParse(await response.json().catch(() => null))
  const reason = parsed.success ? (parsed.data.error.errors?.[0]?.reason ?? '') : ''
  const message = parsed.success ? (parsed.data.error.message ?? '') : ''
  if (reason === 'accessNotConfigured' || /has not been used|is disabled/i.test(message)) {
    return new Error('The Google Calendar API is off in your Google Cloud project: turn it on (APIs & Services → Library → Google Calendar API → Enable), then press Refresh.')
  }
  if (response.status === 403) return new Error(`Google refused access to the calendar${message !== '' ? `: ${message}` : '.'}`)
  if (response.status === 429) return new Error('Google is limiting requests right now. Glimpse will try again in a few minutes.')
  return new Error(`Google Calendar answered ${String(response.status)}.`)
}

/** Sign-in and token errors in plain words. */
function tokenError(code: string): Error {
  if (code === 'invalid_grant') return new Error('Your Google sign-in has expired or was revoked. Disconnect, then sign in with Google again.')
  if (code === 'invalid_client' || code === 'unauthorized_client') {
    return new Error('Google did not accept the client ID and secret. Check them in Google Cloud → Clients (the type must be "Desktop app").')
  }
  return new Error(`Google sign-in failed (${code}).`)
}

async function requestToken(fetcher: Fetch, body: Record<string, string>): Promise<z.infer<typeof TokenSchema>> {
  const response = await fetcher(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body).toString(),
    signal: AbortSignal.timeout(20_000)
  }).catch(() => {
    throw new Error('Could not reach Google. Check the internet connection.')
  })
  const json: unknown = await response.json().catch(() => null)
  const token = TokenSchema.safeParse(json)
  if (response.ok && token.success) return token.data
  const failure = TokenErrorSchema.safeParse(json)
  throw tokenError(failure.success ? failure.data.error : `HTTP ${String(response.status)}`)
}

const DONE_PAGE = (ok: boolean, text: string): string =>
  `<!doctype html><meta charset="utf-8"><title>Glimpse</title><body style="font:16px system-ui;background:#0d0b14;color:#eee;display:grid;place-items:center;height:90vh"><div style="text-align:center"><h2 style="color:${ok ? '#a78bfa' : '#fbbf24'}">${ok ? 'Glimpse is connected' : 'Not connected'}</h2><p>${text}</p></div>`

export interface SignInOptions {
  readonly client: GoogleClient
  readonly openBrowser: (url: string) => Promise<void>
  readonly fetch?: Fetch
  readonly signal?: AbortSignal
  readonly timeoutMs?: number
}

/**
 * The installed-app OAuth flow: Google's consent page opens in the browser and redirects to a
 * one-shot server on 127.0.0.1 with a code, which is swapped for a refresh token (PKCE, state check).
 * Resolves with the refresh token.
 */
export async function signInWithGoogle(options: SignInOptions): Promise<string> {
  const fetcher = options.fetch ?? fetch
  const verifier = base64url(randomBytes(32))
  const challenge = base64url(createHash('sha256').update(verifier).digest())
  const state = base64url(randomBytes(16))
  const server = createServer()
  // Ends the wait for the browser however sign-in ends (an error opening it, a failed token swap).
  const done = new AbortController()
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  try {
    const redirectUri = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`
    const signal = options.signal === undefined ? done.signal : AbortSignal.any([options.signal, done.signal])
    const code = waitForCode(server, state, signal, options.timeoutMs ?? SIGN_IN_TIMEOUT_MS)
    // The answer can arrive (or fail) while the browser is still opening: handled when awaited below.
    code.catch(() => undefined)
    await options.openBrowser(authorizationUrl(options.client, redirectUri, challenge, state))
    const token = await requestToken(fetcher, {
      client_id: options.client.id,
      client_secret: options.client.secret,
      code: await code,
      code_verifier: verifier,
      grant_type: 'authorization_code',
      redirect_uri: redirectUri
    })
    if (token.refresh_token === undefined) throw new Error('Google did not grant lasting access. Try signing in again.')
    return token.refresh_token
  } finally {
    done.abort()
    server.close()
    server.closeAllConnections()
  }
}

function waitForCode(server: Server, state: string, signal: AbortSignal | undefined, timeoutMs: number): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const finish = (error: Error | null, code = ''): void => {
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
      if (error === null) resolve(code)
      else reject(error)
    }
    const timer = setTimeout(() => {
      finish(new Error('Google sign-in did not finish. If Google showed an error (for example that your organisation blocks this app), that account cannot connect this way.'))
    }, timeoutMs)
    const onAbort = (): void => {
      finish(new Error('Google sign-in was cancelled.'))
    }
    signal?.addEventListener('abort', onAbort)
    // Cancelled before the server was even listening.
    if (signal?.aborted === true) onAbort()
    server.on('request', (request, response) => {
      const url = new URL(request.url ?? '/', 'http://127.0.0.1')
      // The browser also asks for /favicon.ico; and a request without our state is not Google's answer.
      if (url.pathname !== '/' || url.searchParams.get('state') !== state) {
        response.writeHead(404).end()
        return
      }
      const error = url.searchParams.get('error')
      const code = url.searchParams.get('code')
      response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
      if (error !== null || code === null) {
        response.end(DONE_PAGE(false, 'Google sign-in was cancelled. You can close this tab.'))
        finish(new Error(error === 'access_denied' ? 'Google sign-in was cancelled.' : `Google sign-in failed (${error ?? 'no code'}).`))
        return
      }
      response.end(DONE_PAGE(true, 'You can close this tab and go back to Glimpse.'))
      finish(null, code)
    })
  })
}

/** Best effort: tells Google to forget the grant. */
export async function revokeGoogleToken(refreshToken: string, fetcher: Fetch = fetch): Promise<void> {
  await fetcher(REVOKE_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ token: refreshToken }).toString(),
    signal: AbortSignal.timeout(10_000)
  }).catch(() => undefined)
}

export interface GoogleCalendarOptions {
  readonly client: () => GoogleClient | null
  readonly refreshToken: () => string | null
  readonly now: () => number
  readonly fetch?: Fetch
}

/** Reads the primary calendar's events through the Calendar API, refreshing the access token as needed. */
export class GoogleCalendar {
  private access: { readonly token: string; readonly expires: number; readonly refresh: string } | null = null

  constructor(private readonly options: GoogleCalendarOptions) {}

  /** Forget the cached access token (after sign-out or a new sign-in). */
  reset(): void {
    this.access = null
  }

  /** Events overlapping [from, to), each repeat on its own (singleEvents). */
  async events(from: number, to: number): Promise<CalendarEvent[]> {
    const items: unknown[] = []
    let pageToken: string | undefined
    for (let page = 0; page < MAX_PAGES; page++) {
      const params = new URLSearchParams({
        timeMin: new Date(from).toISOString(),
        timeMax: new Date(to).toISOString(),
        singleEvents: 'true',
        orderBy: 'startTime',
        maxResults: '250'
      })
      if (pageToken !== undefined) params.set('pageToken', pageToken)
      const json = await this.get(`${EVENTS_URL}?${params.toString()}`)
      const parsed = EventsPageSchema.safeParse(json)
      if (!parsed.success) throw new Error('Google Calendar sent something Glimpse could not read.')
      items.push(...(parsed.data.items ?? []))
      pageToken = parsed.data.nextPageToken
      if (pageToken === undefined) break
    }
    const events = items.flatMap((item) => {
      const parsed = GoogleEventSchema.safeParse(item)
      const event = parsed.success ? fromGoogleEvent(parsed.data) : null
      return event !== null && event.end > from && event.start < to ? [event] : []
    })
    return events.sort((a, b) => a.start - b.start || a.title.localeCompare(b.title))
  }

  private async get(url: string): Promise<unknown> {
    for (let attempt = 0; ; attempt++) {
      const token = await this.accessToken()
      const response = await (this.options.fetch ?? fetch)(url, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(20_000) }).catch(() => {
        throw new Error('Could not reach Google Calendar. Check the internet connection.')
      })
      // An access token can be revoked before it expires: get a new one once.
      if (response.status === 401 && attempt === 0) {
        this.access = null
        continue
      }
      if (!response.ok) throw await apiError(response)
      const json: unknown = await response.json()
      return json
    }
  }

  private async accessToken(): Promise<string> {
    const client = this.options.client()
    const refresh = this.options.refreshToken()
    if (client === null || refresh === null) throw new Error('Not signed in to Google.')
    const now = this.options.now()
    if (this.access !== null && this.access.refresh === refresh && this.access.expires > now + 60_000) return this.access.token
    const token = await requestToken(this.options.fetch ?? fetch, {
      client_id: client.id,
      client_secret: client.secret,
      refresh_token: refresh,
      grant_type: 'refresh_token'
    })
    this.access = { token: token.access_token, expires: now + token.expires_in * 1000, refresh }
    return token.access_token
  }
}

/** The client saved after a sign-in (JSON in the secret store), or null. */
export function parseSavedClient(json: string | null): GoogleClient | null {
  if (json === null) return null
  try {
    const parsed = GoogleClientSchema.safeParse(JSON.parse(json))
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}
