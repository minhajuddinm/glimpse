import type { LibraryHandle } from 'koffi'

/** Win32 wheel-positive is up; DOM deltaY-positive is down. Keeps partial ticks. */
export function wheelDeltaY(mouseData: number): number {
  return -((mouseData >> 16) / 120) * 100 || 0
}

// Retain resources if unhook/unregister fails: leaking is safer than a native UAF.
const pinned = new Set<() => void>()

/**
 * Install on Electron's main thread (requires its Windows message loop).
 * Coordinates are physical screen pixels, including negative monitor positions.
 * onWheel must be synchronous and fast; true consumes ONLY this vertical wheel.
 * Loading is deferred; disposing before loading completes cancels installation.
 */
export function installWindowsWheelHandler(
  onWheel: (point: { x: number; y: number }, deltaY: number) => boolean
): () => void {
  let disposed = false
  let release: (() => void) | undefined
  const dispose = (): void => {
    if (disposed) return
    disposed = true
    // Never unregister a callback while its native trampoline is on the stack.
    if (release) setImmediate(release)
  }
  if (process.platform !== 'win32') {
    console.warn('[wheel] Windows wheel capture is unavailable on this platform')
    return dispose
  }
  void import('koffi').then(({ default: koffi }) => {
    if (disposed) return
    let library: LibraryHandle | undefined
    let callback: bigint | undefined
    let hook: unknown = null
    let cleaned = false
    const cleanup = (): void => {
      if (cleaned) return
      try {
        if (hook !== null) {
          if (!library) throw new Error('Missing hook library')
          const unhook = library.func('bool __stdcall UnhookWindowsHookEx(void *hook)')
          if (!unhook(hook)) throw new Error('UnhookWindowsHookEx failed')
          hook = null
        }
        if (callback !== undefined) {
          koffi.unregister(callback)
          callback = undefined
        }
        library?.unload()
        cleaned = true
        pinned.delete(cleanup)
      } catch (error) {
        console.warn('[wheel] Cleanup failed; retaining native resources:', error)
      }
    }
    release = cleanup
    pinned.add(cleanup)
    try {
      library = koffi.load('user32.dll')
      const point = koffi.struct({ x: 'int32_t', y: 'int32_t' })
      const mouse = koffi.struct({
        pt: point, mouseData: 'uint32_t', flags: 'uint32_t', time: 'uint32_t',
        dwExtraInfo: 'uintptr_t'
      })
      const proc = koffi.proto('__stdcall', 'intptr_t', ['int', 'uintptr_t', 'void *'])
      const next = library.func('intptr_t __stdcall CallNextHookEx(void *hook, int code, uintptr_t message, void *data)')
      const install = library.func('void * __stdcall SetWindowsHookExW(int id, void *proc, void *module, uint32_t thread)')
      callback = koffi.register((code: number, message: number | bigint, data: unknown) => {
        if (!disposed && code === 0 && Number(message) === 0x020a) {
          try {
            const event = koffi.decode(data, mouse) as { pt: { x: number; y: number }; mouseData: number }
            const delta = wheelDeltaY(event.mouseData)
            if (delta !== 0 && onWheel({ x: event.pt.x, y: event.pt.y }, delta)) return 1
          } catch {
            // Fail open. No logging/I/O in the latency-sensitive native callback.
          }
        }
        return next(null, code, message, data) as number | bigint
      }, koffi.pointer(proc))
      hook = install(14, callback, null, 0) as unknown
      if (hook === null || hook === 0 || hook === 0n) {
        hook = null
        throw new Error('SetWindowsHookExW failed')
      }
    } catch (error) {
      disposed = true
      console.warn('[wheel] Windows wheel capture unavailable:', error)
      cleanup()
    }
  }).catch((error: unknown) => {
    console.warn('[wheel] Could not load Windows wheel capture:', error)
  })
  return dispose
}
