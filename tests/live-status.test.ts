import { describe, expect, it } from 'vitest'
import { liveView } from '../src/shared/live'
import { ipcContract, ipcEvents } from '../src/shared/ipc'

describe('live status payloads', () => {
  it('accepts a payload from an older main process that has no mode field', () => {
    // A hot-reloaded renderer can talk to a main process built before `mode` existed.
    // Dropping that event silently left the live card stuck on "0s" with disabled buttons.
    const parsed = ipcEvents['live:status'].safeParse({ endsAt: null })
    expect(parsed.success).toBe(true)
    if (parsed.success) expect(parsed.data).toEqual({ endsAt: null, mode: null })
  })

  it('still carries the mode when main sends one', () => {
    expect(ipcEvents['live:status'].parse({ endsAt: 5, mode: 'control' })).toEqual({ endsAt: 5, mode: 'control' })
  })

  it('has an invoke channel to read the current status', () => {
    expect(ipcContract['live:get'].request.safeParse(null).success).toBe(true)
    expect(ipcContract['live:get'].response.safeParse({ endsAt: null, mode: null }).success).toBe(true)
  })
})

describe('liveView', () => {
  it('is idle with no session', () => {
    expect(liveView({ endsAt: null, mode: null }, 1_000)).toEqual({ running: false, secondsLeft: 0, mode: null })
  })

  it('counts down while a session runs', () => {
    expect(liveView({ endsAt: 31_000, mode: 'protected' }, 1_000)).toEqual({ running: true, secondsLeft: 30, mode: 'protected' })
    expect(liveView({ endsAt: 31_000, mode: 'protected' }, 30_200)).toEqual({ running: true, secondsLeft: 1, mode: 'protected' })
  })

  it('goes idle by itself once the end time has passed, even if the stop event never arrives', () => {
    expect(liveView({ endsAt: 31_000, mode: 'protected' }, 31_000)).toEqual({ running: false, secondsLeft: 0, mode: null })
    expect(liveView({ endsAt: 31_000, mode: 'control' }, 99_000)).toEqual({ running: false, secondsLeft: 0, mode: null })
  })

  it('treats a missing mode as protected while running', () => {
    expect(liveView({ endsAt: 9_000, mode: null }, 1_000)).toEqual({ running: true, secondsLeft: 8, mode: 'protected' })
  })
})
