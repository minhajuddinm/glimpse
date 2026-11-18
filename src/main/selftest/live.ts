import type { LiveStatus } from '../../shared/capture'
import type { OverlayController } from '../overlay'

/**
 * Live capture test (A4, second mode): paints the canary on the real overlay,
 * with protection ON, for a fixed time so the user can record or share their
 * screen with Zoom, Meet, OBS and so on, then report what the recording showed.
 */
export class LiveSession {
  private timer: ReturnType<typeof setTimeout> | null = null
  private endsAt: number | null = null

  constructor(
    private readonly overlay: OverlayController,
    private readonly onStatus: (status: LiveStatus) => void
  ) {}

  status(): LiveStatus {
    return { endsAt: this.endsAt }
  }

  async start(seconds: number): Promise<LiveStatus> {
    if (this.overlay.state().panic) throw new Error('Leave panic mode before starting a live test')
    await this.stop()
    this.overlay.show()
    await this.overlay.setCanary(true)
    this.endsAt = Date.now() + seconds * 1000
    this.timer = setTimeout(() => {
      void this.stop()
    }, seconds * 1000)
    this.onStatus(this.status())
    return this.status()
  }

  async stop(): Promise<LiveStatus> {
    if (this.timer !== null) clearTimeout(this.timer)
    this.timer = null
    if (this.endsAt !== null) {
      this.endsAt = null
      await this.overlay.setCanary(false)
    }
    this.onStatus(this.status())
    return this.status()
  }
}
