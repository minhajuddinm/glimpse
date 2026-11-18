import QRCode from 'qrcode'
import type { Settings } from '../../shared/settings'
import type { AnswersSnapshot } from '../../shared/answers'
import type { CompanionInfo, TranscriptSnapshot } from '../../shared/transcript'
import { CompanionServer, DEFAULT_PORT, newToken } from './server'

export interface CompanionManagerOptions {
  readonly getSettings: () => Settings
  readonly getToken: () => string | null
  readonly setToken: (token: string) => void
  readonly logoFile: string
  readonly snapshot: () => TranscriptSnapshot
  readonly answers: () => AnswersSnapshot
  readonly onInfo: (info: CompanionInfo) => void
}

/** Starts, stops and reconfigures the companion server to match the settings. */
export class CompanionManager {
  private server: CompanionServer | null = null
  private lan = false
  private message = ''

  constructor(private readonly options: CompanionManagerOptions) {}

  private token(): string {
    const existing = this.options.getToken()
    if (existing !== null && existing.length >= 20) return existing
    const fresh = newToken()
    this.options.setToken(fresh)
    return fresh
  }

  async sync(): Promise<CompanionInfo> {
    const { companionEnabled, companionLan } = this.options.getSettings()
    if (!companionEnabled) {
      await this.server?.stop()
      this.server = null
      this.message = ''
    } else if (this.server === null || this.lan !== companionLan) {
      await this.server?.stop()
      this.lan = companionLan
      const server = new CompanionServer({
        token: this.token(),
        lan: companionLan,
        port: DEFAULT_PORT,
        logoFile: this.options.logoFile,
        snapshot: this.options.snapshot,
        answers: this.options.answers
      })
      try {
        await server.start()
        this.server = server
        this.message = ''
      } catch (error) {
        this.server = null
        this.message = `Could not start the companion page: ${error instanceof Error ? error.message : String(error)}`
      }
    }
    const info = await this.info()
    this.options.onInfo(info)
    return info
  }

  /** New access code: every device must scan the new link. */
  async regenerate(): Promise<CompanionInfo> {
    this.options.setToken(newToken())
    await this.server?.stop()
    this.server = null
    return this.sync()
  }

  publish(snapshot: TranscriptSnapshot): void {
    this.server?.publish(snapshot)
  }

  publishAnswers(snapshot: AnswersSnapshot): void {
    this.server?.publishAnswers(snapshot)
  }

  async info(): Promise<CompanionInfo> {
    const urls = this.server?.urls() ?? []
    const first = urls[0]
    const qr = first === undefined ? null : await QRCode.toDataURL(first, { margin: 1, width: 240, color: { dark: '#0b0b12', light: '#ffffff' } })
    const message =
      this.message !== ''
        ? this.message
        : this.server === null
          ? 'Off.'
          : this.lan
            ? urls.length === 0
              ? 'Listening, but no network address was found.'
              : 'Open one of these links on your phone or another computer on the same network or Tailscale.'
            : 'Only this PC can open it. Turn on "Allow other devices" to use your phone.'
    return { running: this.server !== null, urls, qr, message }
  }

  async stop(): Promise<void> {
    await this.server?.stop()
    this.server = null
  }
}
