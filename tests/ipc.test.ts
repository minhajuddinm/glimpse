import { describe, expect, it } from 'vitest'
import { INVOKE_CHANNELS } from '../src/shared/channels'
import { ipcContract } from '../src/shared/ipc'

describe('IPC contract', () => {
  it('preload allow-list matches the contract exactly', () => {
    expect([...INVOKE_CHANNELS].sort()).toEqual(Object.keys(ipcContract).sort())
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
