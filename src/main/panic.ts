import type { OverlayController } from './overlay'

export interface PanicDeps {
  readonly overlay: OverlayController
  readonly hideTray: () => void
  readonly showTray: () => void
  /** Ends any live test, which restores capture protection if a control step had turned it off. */
  readonly stopLive: () => void
}

/**
 * Panic hide (A6): one key hides the overlay and the tray dot instantly and
 * mutes capture; the same key restores everything. Pillar B reads captureMuted
 * (and subscribes with onCaptureMuted) to stop listening while panic is on.
 */
export class PanicController {
  private active = false
  private readonly listeners = new Set<(muted: boolean) => void>()

  constructor(private readonly deps: PanicDeps) {}

  get captureMuted(): boolean {
    return this.active
  }

  onCaptureMuted(listener: (muted: boolean) => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  toggle(): void {
    this.active = !this.active
    if (this.active) {
      // Hide first: nothing visible should outlive the keypress.
      this.deps.overlay.setPanic(true)
      this.deps.hideTray()
      this.deps.stopLive()
    } else {
      this.deps.showTray()
      this.deps.overlay.setPanic(false)
    }
    for (const listener of this.listeners) listener(this.active)
  }
}
