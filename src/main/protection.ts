import type { BrowserWindow } from 'electron'
import type { ProtectionMethod, ProtectionStatus } from '../shared/capture'

export const WDA_NONE = 0x0
export const WDA_MONITOR = 0x1
export const WDA_EXCLUDEFROMCAPTURE = 0x11

/** WDA_EXCLUDEFROMCAPTURE needs Windows 10 version 2004 (build 19041) or later. */
export const MIN_BUILD_FOR_EXCLUDE = 19041

/** Alpha used when only WDA_MONITOR exists: capture shows a black box, so keep it faint. */
export const CAPTURE_SAFE_OPACITY = 0.15

interface Win32 {
  readonly get: (hwnd: bigint) => number | null
  readonly set: (hwnd: bigint, affinity: number) => boolean
}

let win32: Win32 | null = null

/**
 * Loads koffi once. If it is unavailable the overlay still works (Electron's own
 * setContentProtection runs) but the exclusion can no longer be verified.
 */
export async function initProtection(): Promise<void> {
  if (win32 !== null || process.platform !== 'win32') return
  try {
    const koffi = (await import('koffi')).default
    const user32 = koffi.load('user32.dll')
    const getAffinity = user32.func(
      'bool __stdcall GetWindowDisplayAffinity(uintptr_t hwnd, _Out_ uint32_t *pdwAffinity)'
    )
    const setAffinity = user32.func('bool __stdcall SetWindowDisplayAffinity(uintptr_t hwnd, uint32_t affinity)')
    win32 = {
      get: (hwnd) => {
        const out = [0]
        const ok: unknown = getAffinity(hwnd, out)
        return ok === true ? (out[0] ?? null) : null
      },
      set: (hwnd, affinity) => {
        const ok: unknown = setAffinity(hwnd, affinity)
        return ok === true
      }
    }
  } catch (error) {
    console.warn('[protection] koffi unavailable, the exclusion cannot be verified:', error)
  }
}

function handleOf(win: BrowserWindow): bigint {
  return win.getNativeWindowHandle().readBigUInt64LE(0)
}

/** The affinity Glimpse asks Windows for on this build. */
export function targetAffinity(windowsBuild: number | null): number {
  return windowsBuild !== null && windowsBuild < MIN_BUILD_FOR_EXCLUDE ? WDA_MONITOR : WDA_EXCLUDEFROMCAPTURE
}

/** Reads the window's real display affinity from Windows, or null if it cannot be read. */
export function readDisplayAffinity(win: BrowserWindow): number | null {
  if (win32 === null || win.isDestroyed()) return null
  return win32.get(handleOf(win))
}

/**
 * Sets the affinity directly, which works while the window is still hidden.
 * Electron only applies content protection once a window is shown (and clears it
 * on hide), so setting it ourselves first closes the gap before the first frame.
 */
export function setDisplayAffinity(win: BrowserWindow, affinity: number): boolean {
  if (win32 === null || win.isDestroyed()) return false
  return win32.set(handleOf(win), affinity)
}

export function methodFromAffinity(affinity: number | null): ProtectionMethod {
  if (affinity === null) return 'unknown'
  if (affinity === WDA_EXCLUDEFROMCAPTURE) return 'exclude-from-capture'
  if (affinity === WDA_MONITOR) return 'monitor-only'
  return affinity === WDA_NONE ? 'none' : 'unknown'
}

export function describeProtection(
  requested: boolean,
  visible: boolean,
  method: ProtectionMethod,
  affinity: number | null,
  windowsBuild: number | null
): string {
  const hex = affinity === null ? 'unreadable' : `0x${affinity.toString(16)}`
  const build = windowsBuild === null ? 'unknown build' : `build ${windowsBuild}`
  switch (method) {
    case 'exclude-from-capture':
      return `WDA_EXCLUDEFROMCAPTURE (${hex}) on Windows ${build}: overlay is omitted from captures.`
    case 'monitor-only':
      return `WDA_MONITOR (${hex}) on Windows ${build}: captures show a black box, so capture-safe mode keeps the overlay faint.`
    case 'none':
      if (!requested) return `Protection is off (${hex}).`
      return visible
        ? `Protection was requested but Windows reports no display affinity (${hex}).`
        : `Pending: Windows applies the exclusion when the overlay is shown (${hex} while hidden).`
    case 'unknown':
      return `Display affinity ${hex} on Windows ${build} could not be confirmed.`
  }
}

/** Reads the affinity back from Windows and reports what is actually in effect. */
export function inspectProtection(win: BrowserWindow, requested: boolean, windowsBuild: number | null): ProtectionStatus {
  const affinity = readDisplayAffinity(win)
  const method = methodFromAffinity(affinity)
  const visible = win.isVisible()
  const verified =
    affinity !== null && (requested ? method === 'exclude-from-capture' || method === 'monitor-only' : affinity === WDA_NONE)
  return {
    requested,
    method,
    affinity,
    windowsBuild,
    verified,
    captureSafeMode: requested && method === 'monitor-only',
    detail: describeProtection(requested, visible, method, affinity, windowsBuild)
  }
}

/** Turns protection on or off, directly and through Electron, then verifies it. */
export function applyProtection(win: BrowserWindow, on: boolean, windowsBuild: number | null): ProtectionStatus {
  win.setContentProtection(on)
  setDisplayAffinity(win, on ? targetAffinity(windowsBuild) : WDA_NONE)
  const status = inspectProtection(win, on, windowsBuild)
  console.log(`[protection] requested=${on} ${status.detail}`)
  return status
}
