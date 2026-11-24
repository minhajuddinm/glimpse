import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { installWindowsWheelHandler, wheelDeltaY } from '../src/main/wheel'

const native = vi.hoisted(() => ({
  callback: undefined as undefined | ((code: number, message: number | bigint, data: unknown) => number | bigint),
  install: vi.fn(), next: vi.fn(), unhook: vi.fn(), unregister: vi.fn(), unload: vi.fn(),
  decode: vi.fn(), register: vi.fn(), load: vi.fn()
}))
vi.mock('koffi', () => ({ default: {
  load: native.load,
  struct: vi.fn(() => ({})), proto: vi.fn(() => ({})), pointer: vi.fn(() => ({})),
  register: native.register, unregister: native.unregister, decode: native.decode
} }))
function invoke(code: number, message: number | bigint, data: unknown): number | bigint {
  if (!native.callback) throw new Error('Hook not registered')
  return native.callback(code, message, data)
}
const settle = async (): Promise<void> => { await new Promise<void>((resolve) => setImmediate(resolve)) }

beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(process, 'platform', 'get').mockReturnValue('win32')
  vi.spyOn(console, 'warn').mockImplementation(() => undefined)
  native.install.mockReturnValue(123n)
  native.next.mockReturnValue(42n)
  native.unhook.mockReturnValue(true)
  native.decode.mockReturnValue({ pt: { x: -1800, y: 240 }, mouseData: 120 << 16 })
  native.register.mockImplementation((cb: typeof native.callback) => { native.callback = cb; return 456n })
  native.load.mockReturnValue({
    func: (signature: string) => {
      if (signature.includes('SetWindowsHookExW')) return native.install
      if (signature.includes('CallNextHookEx')) return native.next
      if (signature.includes('UnhookWindowsHookEx')) return native.unhook
      throw new Error(signature)
    }, unload: native.unload
  })
})
afterEach(() => { vi.restoreAllMocks() })

describe('wheelDeltaY', () => {
  it.each([[120, -100], [-120, 100], [60, -50], [-30, 25], [240, -200], [0, 0], [-32768, 32768 / 120 * 100]])(
    'decodes signed high word %s ignoring low bits', (ticks, expected) => {
      expect(wheelDeltaY((ticks << 16) | 0xbeef)).toBeCloseTo(expected)
    })
})
describe('Windows wheel hook', () => {
  it('consumes opted-in vertical wheels with physical coordinates and chains everything else unchanged', async () => {
    const handler = vi.fn(() => true)
    const stop = installWindowsWheelHandler(handler)
    await settle()
    expect(native.install).toHaveBeenCalledWith(14, 456n, null, 0)
    const data = { pointer: true }
    expect(invoke(0, 0x020an, data)).toBe(1)
    expect(handler).toHaveBeenCalledWith({ x: -1800, y: 240 }, -100)
    for (const msg of [0x200, 0x201, 0x202, 0x204, 0x205, 0x20e]) {
      expect(invoke(0, msg, data)).toBe(42n)
      expect(native.next).toHaveBeenLastCalledWith(null, 0, msg, data)
    }
    expect(invoke(-1, 0x20a, data)).toBe(42n)
    expect(invoke(1, 0x20a, data)).toBe(42n)
    expect(handler).toHaveBeenCalledTimes(1)
    stop(); stop()
    expect(native.unregister).not.toHaveBeenCalled()
    expect(invoke(0, 0x20a, data)).toBe(42n)
    await settle()
    expect(native.unhook).toHaveBeenCalledTimes(1)
    expect(native.unregister).toHaveBeenCalledWith(456n)
    expect(native.unhook.mock.invocationCallOrder[0]).toBeLessThan(native.unregister.mock.invocationCallOrder[0] ?? 0)
    expect(native.unregister.mock.invocationCallOrder[0]).toBeLessThan(native.unload.mock.invocationCallOrder[0] ?? 0)
  })
  it('passes declined wheels, zero ticks, decode failures and handler exceptions onward', async () => {
    const handler = vi.fn(() => false)
    const stop = installWindowsWheelHandler(handler)
    await settle()
    expect(invoke(0, 0x20a, null)).toBe(42n)
    handler.mockImplementation(() => { throw new Error('renderer unavailable') })
    expect(invoke(0, 0x20a, null)).toBe(42n)
    native.decode.mockReturnValueOnce({ pt: { x: 0, y: 0 }, mouseData: 0 })
    expect(invoke(0, 0x20a, null)).toBe(42n)
    native.decode.mockImplementationOnce(() => { throw new Error('decode') })
    expect(invoke(0, 0x20a, null)).toBe(42n)
    stop(); await settle()
  })
  it('can be disposed inside the handler without freeing an executing trampoline', async () => {
    const stop = installWindowsWheelHandler(() => { stop(); return true })
    await settle()
    expect(invoke(0, 0x20a, null)).toBe(1)
    expect(native.unregister).not.toHaveBeenCalled()
    await settle()
    expect(native.unregister).toHaveBeenCalledTimes(1)
  })
  it('cancels initialization and avoids loading on unsupported platforms', async () => {
    const stop = installWindowsWheelHandler(() => true)
    stop(); await settle()
    expect(native.load).not.toHaveBeenCalled()
    vi.spyOn(process, 'platform', 'get').mockReturnValue('linux')
    installWindowsWheelHandler(() => true)()
    await settle()
    expect(native.load).not.toHaveBeenCalled()
    expect(console.warn).toHaveBeenCalled()
  })
  it('releases a registered callback on installation failure', async () => {
    native.install.mockReturnValue(null)
    const stop = installWindowsWheelHandler(() => true)
    await settle(); stop(); await settle()
    expect(native.unregister).toHaveBeenCalledTimes(1)
    expect(native.unhook).not.toHaveBeenCalled()
    expect(native.unload).toHaveBeenCalledTimes(1)
  })
  it('retains callback and DLL when unhook fails', async () => {
    const stop = installWindowsWheelHandler(() => true)
    await settle()
    native.unhook.mockReturnValue(false)
    stop(); stop(); await settle()
    expect(native.unregister).not.toHaveBeenCalled()
    expect(native.unload).not.toHaveBeenCalled()
    expect(invoke(0, 0x20a, null)).toBe(42n)
  })
  it('retains the DLL if callback unregistering fails after a successful unhook', async () => {
    const stop = installWindowsWheelHandler(() => true)
    await settle()
    native.unregister.mockImplementationOnce(() => { throw new Error('unregister failed') })
    stop(); await settle()
    expect(native.unhook).toHaveBeenCalledTimes(1)
    expect(native.unload).not.toHaveBeenCalled()
    expect(console.warn).toHaveBeenCalled()
  })
  it('handles DLL loading failure without throwing', async () => {
    native.load.mockImplementationOnce(() => { throw new Error('missing DLL') })
    const stop = installWindowsWheelHandler(() => true)
    await settle(); stop()
    expect(console.warn).toHaveBeenCalled()
    expect(native.register).not.toHaveBeenCalled()
  })
})
