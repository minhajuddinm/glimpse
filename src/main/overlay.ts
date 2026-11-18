import { join } from 'node:path'
import { BrowserWindow, screen, type Display } from 'electron'
import type { OverlayState, ProtectionStatus, Rect } from '../shared/capture'
import type { Settings } from '../shared/settings'
import { ClickThroughPoller } from './clickthrough'
import {
  CAPTURE_SAFE_OPACITY,
  WDA_NONE,
  applyProtection,
  initProtection,
  inspectProtection,
  setDisplayAffinity,
  targetAffinity
} from './protection'
import { SECURE_WEB_PREFERENCES, devRendererUrl, lockDownNavigation, rendererFileUrl } from './security'
import { sleep } from './util'

export const OVERLAY_WIDTH = 420
const HEADER_HEIGHT = 56
/** Time for the renderer paint and the desktop compositor to settle before a capture. */
const SETTLE_MS = 160
const CANARY_ACK_TIMEOUT_MS = 2000

export interface OverlayOptions {
  readonly windowsBuild: number | null
  readonly getSettings: () => Settings
  readonly onState: (state: OverlayState) => void
}

export interface OverlayGeometry {
  readonly display: Display
  /** Window bounds in DIPs, in desktop coordinates. */
  readonly bounds: Rect
}

const INITIAL_PROTECTION: ProtectionStatus = {
  requested: false,
  method: 'unknown',
  affinity: null,
  windowsBuild: null,
  verified: false,
  captureSafeMode: false,
  detail: 'Overlay not created yet.'
}

/**
 * Owns the always-on-top overlay window: capture exclusion, click-through,
 * visibility, panic state and the canary pattern used by the capture self-test.
 */
export class OverlayController {
  private win: BrowserWindow | null = null
  private visible = false
  private visibleBeforePanic = false
  private panic = false
  private canary = false
  /** Only the self-test control ever sets this to false, and only briefly. */
  private protectionWanted = true
  private protection: ProtectionStatus = INITIAL_PROTECTION
  private hitRects: Rect[] = [{ x: 0, y: 0, width: OVERLAY_WIDTH, height: HEADER_HEIGHT }]
  private canaryWaiter: ((on: boolean) => void) | null = null
  private readonly poller: ClickThroughPoller

  constructor(private readonly options: OverlayOptions) {
    this.poller = new ClickThroughPoller({
      getCursor: () => screen.getCursorScreenPoint(),
      getBounds: () => (this.win === null || this.win.isDestroyed() ? null : this.win.getBounds()),
      getHitRects: () => this.hitRects,
      isClickThrough: () => this.options.getSettings().clickThrough,
      apply: (ignore) => {
        this.applyIgnore(ignore)
      }
    })
  }

  get window(): BrowserWindow | null {
    return this.win !== null && !this.win.isDestroyed() ? this.win : null
  }

  state(): OverlayState {
    return {
      visible: this.visible,
      clickThrough: this.options.getSettings().clickThrough,
      ignoringMouse: this.poller.ignoring,
      panic: this.panic,
      canary: this.canary,
      protection: this.protection
    }
  }

  geometry(): OverlayGeometry | null {
    const win = this.window
    if (win === null) return null
    const bounds = win.getBounds()
    return { display: screen.getDisplayMatching(bounds), bounds }
  }

  async create(): Promise<void> {
    if (this.window !== null) return
    const { x, y, width, height } = screen.getPrimaryDisplay().workArea
    const win = new BrowserWindow({
      x: x + width - OVERLAY_WIDTH,
      y,
      width: OVERLAY_WIDTH,
      height,
      frame: false,
      transparent: true,
      hasShadow: false,
      backgroundColor: '#00000000',
      alwaysOnTop: true,
      skipTaskbar: true,
      focusable: false,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      show: false,
      title: 'Glimpse overlay',
      webPreferences: { ...SECURE_WEB_PREFERENCES, preload: join(__dirname, '../preload/index.js') }
    })
    this.win = win
    win.setAlwaysOnTop(true, 'screen-saver')
    // Request exclusion before anything is ever painted. Windows applies it on show; show() verifies it.
    await initProtection()
    this.protection = applyProtection(win, true, this.options.windowsBuild)
    lockDownNavigation(win)
    win.on('closed', () => {
      this.poller.stop()
      this.win = null
      this.visible = false
    })

    const dev = devRendererUrl()
    await (dev !== null ? win.loadURL(`${dev}/overlay.html`) : win.loadURL(rendererFileUrl('overlay.html')))
    this.applyOpacity()
    this.poller.start()
    this.emit()
  }

  show(): void {
    const win = this.window
    if (win === null || this.panic) return
    // Set the affinity before the window exists on screen: Electron only applies it at show time.
    if (this.protectionWanted) setDisplayAffinity(win, targetAffinity(this.options.windowsBuild))
    // showInactive never takes focus from the app the user is working in.
    win.showInactive()
    win.setAlwaysOnTop(true, 'screen-saver')
    this.protection = inspectProtection(win, this.protectionWanted, this.options.windowsBuild)
    if (this.protectionWanted && this.protection.affinity === WDA_NONE) {
      // Fail closed: Windows says the overlay is capturable, so it must not stay on screen.
      console.error(`[overlay] hidden, exclusion not in effect: ${this.protection.detail}`)
      win.hide()
      this.visible = false
      this.emit()
      return
    }
    this.visible = true
    this.poller.reset()
    this.poller.tick()
    this.emit()
  }

  hide(): void {
    const win = this.window
    if (win === null) return
    win.hide()
    this.visible = false
    this.emit()
  }

  toggle(): void {
    if (this.panic) return
    if (this.visible) this.hide()
    else this.show()
  }

  /** Re-applies opacity and click-through after a setting changed. */
  applySettings(): void {
    this.applyOpacity()
    this.poller.reset()
    this.poller.tick()
    this.emit()
  }

  setHitRects(rects: readonly Rect[]): void {
    this.hitRects = [...rects]
    this.poller.tick()
  }

  /**
   * Panic: hide the overlay immediately and remember whether to bring it back.
   * The caller hides the tray icon and mutes capture.
   */
  setPanic(on: boolean): void {
    if (on === this.panic) return
    if (on) {
      this.visibleBeforePanic = this.visible
      this.hide()
      this.panic = true
    } else {
      this.panic = false
      if (this.visibleBeforePanic) this.show()
    }
    this.emit()
  }

  /** Paints (or clears) the high-contrast canary pattern and waits until it is on screen. */
  async setCanary(on: boolean): Promise<void> {
    const win = this.window
    if (win === null) return
    this.canary = on
    this.applyOpacity()
    const acked = new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        this.canaryWaiter = null
        resolve()
      }, CANARY_ACK_TIMEOUT_MS)
      this.canaryWaiter = (value) => {
        if (value !== on) return
        clearTimeout(timer)
        this.canaryWaiter = null
        resolve()
      }
    })
    win.webContents.send('overlay:canary', { on })
    await acked
    await sleep(SETTLE_MS)
    this.emit()
  }

  ackCanary(on: boolean): void {
    this.canaryWaiter?.(on)
  }

  /** Turns capture exclusion on or off. Only the self-test control ever turns it off. */
  async setProtection(on: boolean): Promise<ProtectionStatus> {
    const win = this.window
    if (win === null) return this.protection
    this.protectionWanted = on
    this.protection = applyProtection(win, on, this.options.windowsBuild)
    this.applyOpacity()
    await sleep(SETTLE_MS)
    this.emit()
    return this.protection
  }

  protectionStatus(): ProtectionStatus {
    return this.protection
  }

  destroy(): void {
    this.poller.stop()
    this.window?.destroy()
    this.win = null
  }

  private applyIgnore(ignore: boolean): void {
    const win = this.window
    if (win === null) return
    if (ignore) win.setIgnoreMouseEvents(true, { forward: true })
    else win.setIgnoreMouseEvents(false)
    this.emit()
  }

  private applyOpacity(): void {
    const win = this.window
    if (win === null) return
    const opacity = this.canary
      ? 1
      : this.protection.captureSafeMode
        ? CAPTURE_SAFE_OPACITY
        : this.options.getSettings().overlayOpacity
    win.setOpacity(opacity)
  }

  private emit(): void {
    this.options.onState(this.state())
  }
}
