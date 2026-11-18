import { afterEach, describe, expect, it } from 'vitest'
import { CompanionServer, newToken, tokenMatches } from '../src/main/companion/server'
import type { TranscriptSnapshot } from '../src/shared/transcript'

const SNAPSHOT: TranscriptSnapshot = {
  segments: [{ id: 1, source: 'them', text: 'Tell me about yourself', at: 1, latencyMs: 480 }],
  partials: { them: '', you: 'I am a' }
}

let server: CompanionServer | null = null
afterEach(async () => {
  await server?.stop()
  server = null
})

async function start(token = 'secret-token-123'): Promise<string> {
  server = new CompanionServer({ token, lan: false, port: 0, logoFile: null, snapshot: () => SNAPSHOT, answers: () => ({ answers: [] }) })
  await server.start()
  return `http://127.0.0.1:${String(server.port)}`
}

describe('companion tokens', () => {
  it('generates long random codes and compares exactly', () => {
    const a = newToken()
    expect(a.length).toBeGreaterThanOrEqual(24)
    expect(newToken()).not.toBe(a)
    expect(tokenMatches(a, a)).toBe(true)
    expect(tokenMatches(a, `${a}x`)).toBe(false)
    expect(tokenMatches(a, null)).toBe(false)
  })
})

describe('CompanionServer', () => {
  it('serves the empty page publicly, with strict security headers', async () => {
    const base = await start()
    const res = await fetch(`${base}/`)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-security-policy')).toContain("default-src 'none'")
    expect(res.headers.get('cache-control')).toBe('no-store')
    const html = await res.text()
    expect(html).toContain('Live transcript')
    expect(html).not.toContain('Tell me about yourself')
  })

  it('refuses data without the right access code', async () => {
    const base = await start()
    expect((await fetch(`${base}/state`)).status).toBe(401)
    expect((await fetch(`${base}/state?t=wrong`)).status).toBe(401)
    const ok = await fetch(`${base}/state?t=secret-token-123`)
    expect(ok.status).toBe(200)
    expect(await ok.json()).toEqual(SNAPSHOT)
  })

  it('locks out an address after repeated wrong codes', async () => {
    const base = await start()
    for (let i = 0; i < 20; i++) await fetch(`${base}/state?t=guess${i}`)
    expect((await fetch(`${base}/state?t=secret-token-123`)).status).toBe(429)
  })

  it('streams the transcript over server-sent events, then pushes updates', async () => {
    const base = await start()
    const controller = new AbortController()
    const res = await fetch(`${base}/events?t=secret-token-123`, { signal: controller.signal })
    expect(res.headers.get('content-type')).toBe('text/event-stream')
    const reader = res.body?.getReader()
    if (reader === undefined) throw new Error('no body')
    const decoder = new TextDecoder()
    let text = ''
    const read = async (): Promise<string> => {
      const chunk = (await reader.read()) as { done: boolean; value?: Uint8Array }
      return chunk.done || chunk.value === undefined ? '' : decoder.decode(chunk.value)
    }
    while (!text.includes('\n\n')) text += await read()
    expect(text).toContain('event: transcript')
    expect(text).toContain('Tell me about yourself')

    server?.publish({ ...SNAPSHOT, partials: { them: 'next question', you: '' } })
    let next = ''
    while (!next.includes('next question')) next += await read()
    controller.abort()
  })

  it('only offers this-PC URLs when LAN access is off, and rejects other methods', async () => {
    const base = await start('tok')
    expect(server?.urls()).toEqual([`${base}/?t=tok`])
    expect((await fetch(`${base}/`, { method: 'POST' })).status).toBe(405)
    expect((await fetch(`${base}/nope`)).status).toBe(404)
  })
})
