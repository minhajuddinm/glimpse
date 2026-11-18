import type { LiveMode, LiveStatus, OverlayState } from '../../shared/capture'

/** The overlay operations a live session needs, so tests can use a fake. */
export interface LiveOverlay {
  state(): OverlayState
  show(): void
  setCanary(on: boolean): Promise<void>
  setProtection(on: boolean): Promise<unknown>
}

/**
 * Live capture test (A4, second mode). Two steps, run while recording or sharing:
 *
 *  - control: the pattern is shown with protection OFF for a few seconds. A working
 *    recorder or viewer MUST show it; if it does not, the setup cannot see the screen
 *    and the protected step proves nothing.
 *  - protected: the pattern is shown with protection ON. It must NOT appear in the
 *    recording or share, even though it is drawn on the physical monitor.
 *
 * Protection is always restored when a session ends, however it ends.
 */
export class LiveSession {
  private timer: ReturnType<typeof setTimeout> | null = null
  private endsAt: number | null = null
  private mode: LiveMode | null = null

  constructor(
    private readonly overlay: LiveOverlay,
    private readonly onStatus: (status: LiveStatus) => void
  ) {}

  status(): LiveStatus {
    return { endsAt: this.endsAt, mode: this.mode }
  }

  start(seconds: number): Promise<LiveStatus> {
    return this.begin('protected', seconds)
  }

  control(seconds: number): Promise<LiveStatus> {
    return this.begin('control', seconds)
  }

  async stop(): Promise<LiveStatus> {
    if (this.timer !== null) clearTimeout(this.timer)
    this.timer = null
    const wasControl = this.mode === 'control'
    if (this.mode !== null) {
      this.endsAt = null
      this.mode = null
      // Re-protect first, so nothing is ever visible unprotected except the pattern itself.
      if (wasControl) await this.overlay.setProtection(true)
      await this.overlay.setCanary(false)
    }
    this.onStatus(this.status())
    return this.status()
  }

  private async begin(mode: LiveMode, seconds: number): Promise<LiveStatus> {
    if (this.overlay.state().panic) throw new Error('Leave panic mode before starting a live test')
    await this.stop()
    this.overlay.show()
    await this.overlay.setCanary(true)
    if (mode === 'control') await this.overlay.setProtection(false)
    this.mode = mode
    this.endsAt = Date.now() + seconds * 1000
    this.timer = setTimeout(() => {
      void this.stop()
    }, seconds * 1000)
    this.onStatus(this.status())
    return this.status()
  }
}
