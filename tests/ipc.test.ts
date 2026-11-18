import { describe, expect, it } from 'vitest'
import { EVENT_CHANNELS, INVOKE_CHANNELS } from '../src/shared/channels'
import { ipcContract, ipcEvents } from '../src/shared/ipc'

describe('IPC contract', () => {
  it('preload invoke allow-list matches the contract exactly', () => {
    expect([...INVOKE_CHANNELS].sort()).toEqual(Object.keys(ipcContract).sort())
  })

  it('preload event allow-list matches the event schemas exactly', () => {
    expect([...EVENT_CHANNELS].sort()).toEqual(Object.keys(ipcEvents).sort())
  })

  it('rejects out-of-range live-test durations and hotkey payloads', () => {
    expect(ipcContract['live:start'].request.safeParse({ seconds: 1 }).success).toBe(false)
    expect(ipcContract['live:start'].request.safeParse({ seconds: 60 }).success).toBe(true)
    expect(ipcContract['hotkeys:set'].request.safeParse({ action: 'launchMissiles', accelerator: 'Ctrl+K' }).success).toBe(false)
  })

  it('does not let the renderer change hotkeys through settings:update', () => {
    const parsed = ipcContract['settings:update'].request.parse({ mode: 'sales', hotkeys: { panicHide: 'Ctrl+X' } })
    expect(parsed).toEqual({ mode: 'sales' })
  })

  it('rejects malformed settings patches', () => {
    const schema = ipcContract['settings:update'].request
    expect(schema.safeParse({ overlayOpacity: 0.05 }).success).toBe(false)
    expect(schema.safeParse({ mode: 'karaoke' }).success).toBe(false)
    expect(schema.safeParse({ clickThrough: 'yes' }).success).toBe(false)
    expect(schema.safeParse({ mode: 'interview' }).success).toBe(true)
  })

  it('no-argument channels accept only null', () => {
    expect(ipcContract['app:info'].request.safeParse(null).success).toBe(true)
    expect(ipcContract['app:info'].request.safeParse({}).success).toBe(false)
  })
})
