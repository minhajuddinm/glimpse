import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { LiveStatus, OverlayState } from '../src/shared/capture'
import { LiveSession, type LiveOverlay } from '../src/main/selftest/live'

class FakeOverlay implements LiveOverlay {
  panic = false
  protectionOn = true
  canary = false
  visible = false
  readonly log: string[] = []
  hidden = false

  state(): OverlayState {
    return {
      visible: this.visible,
      clickThrough: true,
      ignoringMouse: false,
      panic: this.panic,
      canary: this.canary,
      protection: {
        requested: this.protectionOn,
        method: 'exclude-from-capture',
        affinity: 17,
        windowsBuild: 26300,
        verified: true,
        captureSafeMode: false,
        detail: ''
      }
    }
  }

  show(): void {
    this.visible = true
    this.log.push('show')
  }

  hide(): void {
    this.visible = false
    this.hidden = true
    this.log.push('hide')
  }

  setCanary(on: boolean): Promise<void> {
    this.canary = on
    this.log.push(`canary:${on}`)
    return Promise.resolve()
  }

  setProtection(on: boolean): Promise<unknown> {
    this.protectionOn = on
    this.log.push(`protection:${on}`)
    return Promise.resolve()
  }
}

describe('LiveSession', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  function setup() {
    const overlay = new FakeOverlay()
    const statuses: LiveStatus[] = []
    const session = new LiveSession(overlay, (status) => statuses.push(status))
    return { overlay, statuses, session }
  }

  it('protected mode shows the pattern with protection untouched, then clears it on timeout', async () => {
    const { overlay, session } = setup()
    const status = await session.start(30)
    expect(status.mode).toBe('protected')
    expect(overlay.canary).toBe(true)
    expect(overlay.protectionOn).toBe(true)
    expect(overlay.log).not.toContain('protection:false')

    await vi.advanceTimersByTimeAsync(30_000)
    expect(overlay.canary).toBe(false)
    expect(session.status()).toEqual({ endsAt: null, mode: null })
  })

  it('control mode turns protection off, and turns it back on before clearing the pattern', async () => {
    const { overlay, session } = setup()
    const status = await session.control(5)
    expect(status.mode).toBe('control')
    expect(overlay.protectionOn).toBe(false)

    await vi.advanceTimersByTimeAsync(5_000)
    expect(overlay.protectionOn).toBe(true)
    expect(overlay.canary).toBe(false)
    const restore = overlay.log.indexOf('protection:true')
    expect(restore).toBeGreaterThan(-1)
    expect(restore).toBeLessThan(overlay.log.lastIndexOf('canary:false'))
  })

  it('restores protection when a control step is stopped early', async () => {
    const { overlay, session } = setup()
    await session.control(5)
    await session.stop()
    expect(overlay.protectionOn).toBe(true)
    expect(overlay.canary).toBe(false)
  })

  it('starting a protected test during a control step restores protection first', async () => {
    const { overlay, session } = setup()
    await session.control(5)
    await session.start(30)
    expect(overlay.protectionOn).toBe(true)
    expect(session.status().mode).toBe('protected')
  })

  it('refuses to start in panic mode and leaves protection on', async () => {
    const { overlay, session } = setup()
    overlay.panic = true
    await expect(session.control(5)).rejects.toThrow(/panic/)
    expect(overlay.protectionOn).toBe(true)
  })

  it('stop() with nothing running is a no-op that never touches protection', async () => {
    const { overlay, session } = setup()
    await session.stop()
    expect(overlay.log).toEqual([])
  })
})

describe('LiveSession when the overlay misbehaves', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('still reports the session as ended if clearing the pattern throws', async () => {
    const overlay = new FakeOverlay()
    const statuses: LiveStatus[] = []
    const session = new LiveSession(overlay, (status) => statuses.push(status))
    await session.start(30)

    overlay.setCanary = () => Promise.reject(new Error('overlay window is gone'))
    await expect(session.stop()).rejects.toThrow(/gone/)

    expect(session.status()).toEqual({ endsAt: null, mode: null })
    expect(statuses.at(-1)).toEqual({ endsAt: null, mode: null })
  })

  it('still clears the pattern if restoring protection throws, and reports the end', async () => {
    const overlay = new FakeOverlay()
    const statuses: LiveStatus[] = []
    const session = new LiveSession(overlay, (status) => statuses.push(status))
    await session.control(5)

    overlay.setProtection = () => Promise.reject(new Error('koffi failed'))
    await expect(session.stop()).rejects.toThrow(/koffi/)

    expect(overlay.canary).toBe(false)
    expect(statuses.at(-1)).toEqual({ endsAt: null, mode: null })
  })

  it('hides the overlay if protection cannot be restored after a control step', async () => {
    const overlay = new FakeOverlay()
    const session = new LiveSession(overlay, () => undefined)
    await session.control(5)

    overlay.setProtection = () => Promise.reject(new Error('koffi failed'))
    await expect(session.stop()).rejects.toThrow(/koffi/)

    // An unprotected overlay must never be left on screen.
    expect(overlay.hidden).toBe(true)
    expect(overlay.visible).toBe(false)
  })

  it('a timer-driven stop that fails does not become an unhandled rejection', async () => {
    const overlay = new FakeOverlay()
    const session = new LiveSession(overlay, () => undefined)
    await session.start(5)
    overlay.setCanary = () => Promise.reject(new Error('boom'))

    const unhandled: unknown[] = []
    const listener = (reason: unknown): void => {
      unhandled.push(reason)
    }
    process.on('unhandledRejection', listener)
    await vi.advanceTimersByTimeAsync(5_000)
    await vi.advanceTimersByTimeAsync(10)
    process.off('unhandledRejection', listener)

    expect(unhandled).toEqual([])
    expect(session.status()).toEqual({ endsAt: null, mode: null })
  })
})
