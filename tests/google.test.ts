import { connect } from 'node:net'
import { describe, expect, it } from 'vitest'
import { authorizationUrl, checkGoogleClient, fromGoogleEvent, GoogleCalendar, parseSavedClient, signInWithGoogle, type Fetch } from '../src/main/calendar/google'

const CLIENT = { id: '1234-abc.apps.googleusercontent.com', secret: 'GOCSPX-test' }
const json = (body: unknown, status = 200): Response => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

describe('Google client', () => {
  it('checks what was pasted from Google Cloud', () => {
    expect(checkGoogleClient(` ${CLIENT.id} `, ' GOCSPX-test ')).toEqual(CLIENT)
    expect(() => checkGoogleClient('my-project', 'x')).toThrow(/apps\.googleusercontent\.com/)
    expect(() => checkGoogleClient(CLIENT.id, '')).toThrow(/client secret/)
    expect(parseSavedClient(JSON.stringify(CLIENT))).toEqual(CLIENT)
    expect(parseSavedClient('{oops')).toBeNull()
    expect(parseSavedClient(null)).toBeNull()
  })

  it('asks for read-only events with PKCE and offline access', () => {
    const url = new URL(authorizationUrl(CLIENT, 'http://127.0.0.1:5000', 'challenge', 'state'))
    expect(url.searchParams.get('scope')).toBe('https://www.googleapis.com/auth/calendar.events.readonly')
    expect(url.searchParams.get('code_challenge_method')).toBe('S256')
    expect(url.searchParams.get('access_type')).toBe('offline')
    expect(url.searchParams.get('redirect_uri')).toBe('http://127.0.0.1:5000')
  })
})

describe('Google events', () => {
  const base = { id: 'e1', summary: ' Acme pricing call ', start: { dateTime: '2026-11-23T14:00:00-05:00' }, end: { dateTime: '2026-11-23T14:30:00-05:00' } }

  it('maps a meeting: times, people, the Meet link, plain-text description', () => {
    const event = fromGoogleEvent({
      ...base,
      description: 'Agenda:<br>pricing &amp; terms',
      hangoutLink: 'https://meet.google.com/abc-defg-hij',
      attendees: [
        { email: 'me@example.edu', self: true, responseStatus: 'accepted' },
        { email: 'priya@acme.com', displayName: 'Priya Shah', responseStatus: 'needsAction' },
        { email: 'gone@acme.com', responseStatus: 'declined' },
        { email: 'room@resource.calendar.google.com', resource: true }
      ]
    })
    expect(event).toMatchObject({
      id: 'e1',
      title: 'Acme pricing call',
      start: Date.parse('2026-11-23T19:00:00Z'),
      end: Date.parse('2026-11-23T19:30:00Z'),
      allDay: false,
      description: 'Agenda:\npricing & terms',
      link: 'https://meet.google.com/abc-defg-hij'
    })
    expect(event?.attendees.map((person) => person.email)).toEqual(['me@example.edu', 'priya@acme.com'])
  })

  it('reads all-day dates as local midnight and finds Zoom links in the conference data', () => {
    const allDay = fromGoogleEvent({ id: 'a', start: { date: '2026-11-23' }, end: { date: '2026-11-24' } })
    expect(allDay).toMatchObject({ allDay: true, start: new Date(2026, 10, 23).getTime(), end: new Date(2026, 10, 24).getTime(), title: '(No title)' })
    const zoom = fromGoogleEvent({ ...base, conferenceData: { entryPoints: [{ entryPointType: 'phone', uri: 'tel:+1' }, { entryPointType: 'video', uri: 'https://acme.zoom.us/j/123' }] } })
    expect(zoom?.link).toBe('https://acme.zoom.us/j/123')
  })

  it('leaves out cancelled events, ones you declined, and working-location markers', () => {
    expect(fromGoogleEvent({ ...base, status: 'cancelled' })).toBeNull()
    expect(fromGoogleEvent({ ...base, attendees: [{ email: 'me@x.com', self: true, responseStatus: 'declined' }] })).toBeNull()
    expect(fromGoogleEvent({ ...base, eventType: 'workingLocation' })).toBeNull()
    expect(fromGoogleEvent({ id: 'x' })).toBeNull()
  })
})

function api(routes: (url: URL, init: RequestInit | undefined) => Response) {
  const calls: string[] = []
  const fetcher: Fetch = (url, init) => {
    const parsed = new URL(url)
    calls.push(`${parsed.hostname}${parsed.pathname}`)
    return Promise.resolve(routes(parsed, init))
  }
  return { fetcher, calls }
}

describe('GoogleCalendar', () => {
  const from = Date.parse('2026-11-23T00:00:00Z')
  const to = Date.parse('2026-11-24T00:00:00Z')
  const item = (id: string, hour: number) => ({ id, summary: id, start: { dateTime: `2026-11-23T${String(hour).padStart(2, '0')}:00:00Z` }, end: { dateTime: `2026-11-23T${String(hour).padStart(2, '0')}:30:00Z` } })

  it('refreshes the access token once, reuses it, and follows pages', async () => {
    let tokens = 0
    const { fetcher, calls } = api((url, init) => {
      if (url.hostname === 'oauth2.googleapis.com') {
        tokens++
        expect((typeof init?.body === 'string' ? init.body : '')).toContain('grant_type=refresh_token')
        return json({ access_token: 'at', expires_in: 3600 })
      }
      return url.searchParams.get('pageToken') === null ? json({ items: [item('b', 10)], nextPageToken: 'p2' }) : json({ items: [item('a', 9)] })
    })
    const google = new GoogleCalendar({ client: () => CLIENT, refreshToken: () => 'rt', now: () => from, fetch: fetcher })
    expect((await google.events(from, to)).map((event) => event.id)).toEqual(['a', 'b'])
    await google.events(from, to)
    expect(tokens).toBe(1)
    expect(calls.filter((call) => call.endsWith('/events'))).toHaveLength(4)
  })

  it('gets a new access token once on 401', async () => {
    let tokens = 0
    let lists = 0
    const { fetcher } = api((url) => {
      if (url.hostname === 'oauth2.googleapis.com') return json({ access_token: `at${String(++tokens)}`, expires_in: 3600 })
      return ++lists === 1 ? json({ error: { code: 401 } }, 401) : json({ items: [] })
    })
    const google = new GoogleCalendar({ client: () => CLIENT, refreshToken: () => 'rt', now: () => from, fetch: fetcher })
    expect(await google.events(from, to)).toEqual([])
    expect(tokens).toBe(2)
  })

  it('explains the usual failures in plain words', async () => {
    const off = api((url) =>
      url.hostname === 'oauth2.googleapis.com'
        ? json({ access_token: 'at', expires_in: 3600 })
        : json({ error: { code: 403, message: 'Google Calendar API has not been used in project 1 before or it is disabled.', errors: [{ reason: 'accessNotConfigured' }] } }, 403)
    )
    await expect(new GoogleCalendar({ client: () => CLIENT, refreshToken: () => 'rt', now: () => from, fetch: off.fetcher }).events(from, to)).rejects.toThrow(/Calendar API is off/)

    const expired = api(() => json({ error: 'invalid_grant' }, 400))
    await expect(new GoogleCalendar({ client: () => CLIENT, refreshToken: () => 'rt', now: () => from, fetch: expired.fetcher }).events(from, to)).rejects.toThrow(/sign in with Google again/)

    const wrong = api(() => json({ error: 'invalid_client' }, 401))
    await expect(new GoogleCalendar({ client: () => CLIENT, refreshToken: () => 'rt', now: () => from, fetch: wrong.fetcher }).events(from, to)).rejects.toThrow(/Desktop app/)

    await expect(new GoogleCalendar({ client: () => null, refreshToken: () => 'rt', now: () => from }).events(from, to)).rejects.toThrow(/Not signed in/)

    // A body that is not JSON: a readable message, not a raw parser error.
    const garbled = api((url) => (url.hostname === 'oauth2.googleapis.com' ? json({ access_token: 'at', expires_in: 3600 }) : new Response('<html>proxy error</html>', { status: 200 })))
    await expect(new GoogleCalendar({ client: () => CLIENT, refreshToken: () => 'rt', now: () => from, fetch: garbled.fetcher }).events(from, to)).rejects.toThrow(
      'Google Calendar sent something Glimpse could not read.'
    )
  })
})

describe('signInWithGoogle', () => {
  /** Plays the browser: follows Google's redirect back to Glimpse's loopback address. */
  const browser = (answer: (state: string) => string) => async (authUrl: string) => {
    const url = new URL(authUrl)
    const redirect = url.searchParams.get('redirect_uri') ?? ''
    await fetch(`${redirect}/favicon.ico`) // Ignored.
    await fetch(`${redirect}/?state=wrong&code=evil`) // Not Google's answer: ignored.
    const page = await fetch(`${redirect}/?${answer(url.searchParams.get('state') ?? '')}`)
    await page.text()
  }

  it('swaps the code for a refresh token with the PKCE verifier', async () => {
    let body = ''
    const { fetcher } = api((_url, init) => {
      body = (typeof init?.body === 'string' ? init.body : '')
      return json({ access_token: 'at', expires_in: 3600, refresh_token: 'rt-1' })
    })
    const token = await signInWithGoogle({ client: CLIENT, fetch: fetcher, openBrowser: browser((state) => `state=${state}&code=good`) })
    expect(token).toBe('rt-1')
    const params = new URLSearchParams(body)
    expect(params.get('code')).toBe('good')
    expect(params.get('grant_type')).toBe('authorization_code')
    expect(params.get('code_verifier')?.length).toBeGreaterThan(40)
    expect(params.get('client_secret')).toBe(CLIENT.secret)
  })

  it('reports a cancelled consent, a cancel from Glimpse, and a timeout', async () => {
    const { fetcher } = api(() => json({}))
    await expect(signInWithGoogle({ client: CLIENT, fetch: fetcher, openBrowser: browser((state) => `state=${state}&error=access_denied`) })).rejects.toThrow(/cancelled/)

    const controller = new AbortController()
    const pending = signInWithGoogle({ client: CLIENT, fetch: fetcher, signal: controller.signal, openBrowser: () => Promise.resolve() })
    controller.abort()
    await expect(pending).rejects.toThrow(/cancelled/)

    await expect(signInWithGoogle({ client: CLIENT, fetch: fetcher, timeoutMs: 50, openBrowser: () => Promise.resolve() })).rejects.toThrow(/did not finish/)
  })

  it('answers a malformed request instead of throwing in the main process', async () => {
    const { fetcher } = api(() => json({ access_token: 'at', expires_in: 3600, refresh_token: 'rt-1' }))
    let reply = ''
    const token = await signInWithGoogle({
      client: CLIENT,
      fetch: fetcher,
      openBrowser: async (authUrl) => {
        const url = new URL(authUrl)
        const redirect = new URL(url.searchParams.get('redirect_uri') ?? '')
        // A request line no URL parser accepts, as any local program could send.
        reply = await new Promise<string>((resolve) => {
          const socket = connect(Number(redirect.port), '127.0.0.1', () => {
            socket.end('GET http://[ HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n')
          })
          let out = ''
          socket.on('data', (chunk: Buffer) => {
            out += chunk.toString()
            socket.destroy()
            resolve(out)
          })
          socket.on('close', () => {
            resolve(out)
          })
        })
        await (await fetch(`${redirect.origin}/?state=${url.searchParams.get('state') ?? ''}&code=c`)).text()
      }
    })
    expect(reply).toMatch(/^HTTP\/1\.1 404/)
    expect(token).toBe('rt-1')
  })

  it('a cancel during the token swap stops it, so nothing is saved', async () => {
    const controller = new AbortController()
    let aborted = false
    const fetcher: Fetch = (_url, init) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          aborted = true
          reject(new Error('aborted'))
        })
        // Google has the code: Glimpse is now waiting for the token, and the user presses Cancel.
        controller.abort()
      })
    await expect(signInWithGoogle({ client: CLIENT, fetch: fetcher, signal: controller.signal, openBrowser: browser((state) => `state=${state}&code=c`) })).rejects.toThrow(
      'Google sign-in was cancelled.'
    )
    expect(aborted).toBe(true)
  })

  it('a refused code while signing in says to try again, not to disconnect', async () => {
    const { fetcher } = api(() => json({ error: 'invalid_grant' }, 400))
    const failure = signInWithGoogle({ client: CLIENT, fetch: fetcher, openBrowser: browser((state) => `state=${state}&code=old`) })
    await expect(failure).rejects.toThrow(/Try signing in again/)
    await expect(failure).rejects.not.toThrow(/Disconnect/)
  })

  it('fails clearly when Google grants no refresh token', async () => {
    const { fetcher } = api(() => json({ access_token: 'at', expires_in: 3600 }))
    await expect(signInWithGoogle({ client: CLIENT, fetch: fetcher, openBrowser: browser((state) => `state=${state}&code=c`) })).rejects.toThrow(/lasting access/)
  })
})
