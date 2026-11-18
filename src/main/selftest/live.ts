import type { LiveMode, LiveStatus, OverlayState } from '../../shared/capture'

/** The overlay operations a live session needs, so tests can use a fake. */
export interface LiveOverlay {
  state(): OverlayState
  show(): void
  hide(): void
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
 * Protection is always restored when a session ends, however it ends. If it cannot
 * be restored the overlay is hidden rather than left capturable.
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

  /** Ends the session. The status change is always reported, even if the overlay throws. */
  async stop(): Promise<LiveStatus> {
    if (this.timer !== null) clearTimeout(this.timer)
    this.timer = null
    const wasRunning = this.mode !== null
    const wasControl = this.mode === 'control'
    this.endsAt = null
    this.mode = null
    try {
      if (wasRunning) {
        try {
          // Re-protect first, so nothing is ever visible unprotected except the pattern itself.
          if (wasControl) await this.restoreProtection()
        } finally {
          await this.overlay.setCanary(false)
        }
      }
    } finally {
      this.onStatus(this.status())
    }
    return this.status()
  }

  private async restoreProtection(): Promise<void> {
    try {
      await this.overlay.setProtection(true)
    } catch (error) {
      // Never leave a capturable overlay on screen.
      this.overlay.hide()
      throw error
    }
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
      this.stop().catch((error: unknown) => {
        console.error('[live] timed stop failed', error)
      })
    }, seconds * 1000)
    this.onStatus(this.status())
    return this.status()
  }
}
