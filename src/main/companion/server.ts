import { randomBytes, timingSafeEqual } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { networkInterfaces } from 'node:os'
import type { AnswersSnapshot } from '../../shared/answers'
import type { TranscriptSnapshot } from '../../shared/transcript'
import { COMPANION_CSS, COMPANION_HTML, COMPANION_JS } from './page'

export const DEFAULT_PORT = 47823
const MAX_BAD_ATTEMPTS = 20
const BAD_ATTEMPT_WINDOW_MS = 60_000
const MAX_CLIENTS = 8

export function newToken(): string {
  return randomBytes(18).toString('base64url')
}

/** Constant-time token comparison. */
export function tokenMatches(expected: string, given: string | null): boolean {
  if (given === null) return false
  const a = Buffer.from(expected)
  const b = Buffer.from(given)
  return a.length === b.length && timingSafeEqual(a, b)
}

/** IPv4 addresses a phone could reach: LAN and Tailscale (100.x), not loopback. */
export function reachableAddresses(): string[] {
  const out: string[] = []
  for (const list of Object.values(networkInterfaces())) {
    for (const entry of list ?? []) {
      if (entry.family === 'IPv4' && !entry.internal) out.push(entry.address)
    }
  }
  return out
}

const SECURITY_HEADERS: Record<string, string> = {
  'Content-Security-Policy': "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Cache-Control': 'no-store'
}

export interface CompanionOptions {
  readonly token: string
  /** true: listen on all interfaces (LAN / Tailscale); false: this PC only. */
  readonly lan: boolean
  readonly port: number
  readonly logoFile: string | null
  readonly snapshot: () => TranscriptSnapshot
  readonly answers: () => AnswersSnapshot
}

/**
 * Serves the companion page to a second device. The page itself is public and
 * empty; every piece of data (/events, /state) needs the random access code from
 * the URL, compared in constant time, with repeated wrong codes locked out.
 */
export class CompanionServer {
  private server: Server | null = null
  private readonly clients = new Set<ServerResponse>()
  private readonly badAttempts = new Map<string, number[]>()
  private keepAlive: ReturnType<typeof setInterval> | null = null
  private logo: Buffer | null = null

  constructor(private options: CompanionOptions) {}

  get port(): number | null {
    const address = this.server?.address()
    return address !== null && typeof address === 'object' ? address.port : null
  }

  get running(): boolean {
    return this.server !== null
  }

  urls(): string[] {
    const port = this.port
    if (port === null) return []
    const hosts = this.options.lan ? reachableAddresses() : ['127.0.0.1']
    return hosts.map((host) => `http://${host}:${port}/?t=${this.options.token}`)
  }

  async start(): Promise<void> {
    if (this.server !== null) return
    if (this.options.logoFile !== null) {
      try {
        this.logo = readFileSync(this.options.logoFile)
      } catch {
        this.logo = null
      }
    }
    const server = createServer((req, res) => {
      this.handle(req, res)
    })
    const host = this.options.lan ? '0.0.0.0' : '127.0.0.1'
    await new Promise<void>((resolve, reject) => {
      server.once('error', (error: NodeJS.ErrnoException) => {
        // The preferred port is taken: fall back to any free port.
        if (error.code === 'EADDRINUSE' && this.options.port !== 0) {
          server.listen(0, host, () => {
            resolve()
          })
        } else reject(error)
      })
      server.listen(this.options.port, host, () => {
        resolve()
      })
    })
    this.server = server
    this.keepAlive = setInterval(() => {
      for (const client of this.clients) client.write(': ping\n\n')
    }, 20_000)
  }

  async stop(): Promise<void> {
    if (this.keepAlive !== null) clearInterval(this.keepAlive)
    this.keepAlive = null
    for (const client of this.clients) client.end()
    this.clients.clear()
    const server = this.server
    this.server = null
    if (server !== null) await new Promise<void>((resolve) => server.close(() => { resolve() }))
  }

  /** Pushes the latest answers to every connected device. */
  publishAnswers(snapshot: AnswersSnapshot): void {
    const frame = `event: answers\ndata: ${JSON.stringify(snapshot)}\n\n`
    for (const client of this.clients) client.write(frame)
  }

  /** Pushes the latest transcript to every connected device. */
  publish(snapshot: TranscriptSnapshot): void {
    const frame = `event: transcript\ndata: ${JSON.stringify(snapshot)}\n\n`
    for (const client of this.clients) client.write(frame)
  }

  private lockedOut(ip: string): boolean {
    const now = Date.now()
    const recent = (this.badAttempts.get(ip) ?? []).filter((at) => now - at < BAD_ATTEMPT_WINDOW_MS)
    this.badAttempts.set(ip, recent)
    return recent.length >= MAX_BAD_ATTEMPTS
  }

  private recordBad(ip: string): void {
    this.badAttempts.set(ip, [...(this.badAttempts.get(ip) ?? []), Date.now()])
  }

  private send(res: ServerResponse, status: number, type: string, body: string | Buffer): void {
    res.writeHead(status, { ...SECURITY_HEADERS, 'Content-Type': type })
    res.end(body)
  }

  private handle(req: IncomingMessage, res: ServerResponse): void {
    const url = new URL(req.url ?? '/', 'http://companion.local')
    const ip = req.socket.remoteAddress ?? 'unknown'
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      this.send(res, 405, 'text/plain', 'Method not allowed')
      return
    }
    switch (url.pathname) {
      case '/':
        this.send(res, 200, 'text/html; charset=utf-8', COMPANION_HTML)
        return
      case '/app.js':
        this.send(res, 200, 'text/javascript; charset=utf-8', COMPANION_JS)
        return
      case '/app.css':
        this.send(res, 200, 'text/css; charset=utf-8', COMPANION_CSS)
        return
      case '/logo.png':
        if (this.logo === null) this.send(res, 404, 'text/plain', 'Not found')
        else this.send(res, 200, 'image/png', this.logo)
        return
      case '/state':
      case '/events': {
        if (this.lockedOut(ip)) {
          this.send(res, 429, 'text/plain', 'Too many attempts')
          return
        }
        if (!tokenMatches(this.options.token, url.searchParams.get('t'))) {
          this.recordBad(ip)
          this.send(res, 401, 'text/plain', 'Wrong or missing access code')
          return
        }
        if (url.pathname === '/state') {
          this.send(res, 200, 'application/json', JSON.stringify(this.options.snapshot()))
          return
        }
        if (this.clients.size >= MAX_CLIENTS) {
          this.send(res, 503, 'text/plain', 'Too many devices connected')
          return
        }
        res.writeHead(200, { ...SECURITY_HEADERS, 'Content-Type': 'text/event-stream', Connection: 'keep-alive' })
        res.write(`event: transcript\ndata: ${JSON.stringify(this.options.snapshot())}\n\n`)
        res.write(`event: answers\ndata: ${JSON.stringify(this.options.answers())}\n\n`)
        this.clients.add(res)
        req.on('close', () => {
          this.clients.delete(res)
        })
        return
      }
      default:
        this.send(res, 404, 'text/plain', 'Not found')
    }
  }
}
