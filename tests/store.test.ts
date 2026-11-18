import { describe, expect, it } from 'vitest'
import { openDatabase } from '../src/main/db'
import { CaptureStore } from '../src/main/selftest/store'
import { SettingsStore } from '../src/main/settingsStore'
import { DEFAULT_SETTINGS } from '../src/shared/settings'
import type { SelfTestResult } from '../src/shared/capture'

const RESULT: SelfTestResult = {
  verdict: 'PASS',
  ranAt: '2026-11-18T05:00:00.000Z',
  displayId: 1,
  scaleFactor: 1,
  overlayRectPx: { x: 860, y: 0, width: 420, height: 672 },
  grid: { cols: 2, rows: 6 },
  protectedRegions: [{ row: 0, col: 0, canaryPixels: 0, totalPixels: 100, status: 'PASS' }],
  controlDetectedFraction: 1,
  protection: {
    requested: true,
    method: 'exclude-from-capture',
    affinity: 17,
    windowsBuild: 26300,
    verified: true,
    captureSafeMode: false,
    detail: 'ok'
  },
  notes: ['ok'],
  protectedImage: 'data:image/png;base64,AAAA',
  controlImage: 'data:image/png;base64,BBBB'
}

describe('CaptureStore', () => {
  it('round-trips the last self-test but never persists the screenshot strips', () => {
    const store = new CaptureStore(openDatabase(':memory:'))
    expect(store.lastSelfTest()).toBeNull()
    store.saveSelfTest(RESULT)
    expect(store.lastSelfTest()).toEqual({ ...RESULT, protectedImage: null, controlImage: null })
  })

  it('keeps one matrix row per app and replaces it on re-test', () => {
    const store = new CaptureStore(openDatabase(':memory:'))
    store.saveMatrixRow({ app: 'Zoom', result: 'FAIL', notes: 'first try', testedAt: '2026-11-18T05:00:00.000Z', windowsBuild: 26300 })
    store.saveMatrixRow({ app: 'OBS Display Capture', result: 'PASS', notes: '', testedAt: '2026-11-18T05:01:00.000Z', windowsBuild: null })
    store.saveMatrixRow({ app: 'Zoom', result: 'PASS', notes: 'second try', testedAt: '2026-11-18T05:02:00.000Z', windowsBuild: 26300 })
    const rows = store.matrix()
    expect(rows.map((row) => `${row.app}:${row.result}`)).toEqual(['OBS Display Capture:PASS', 'Zoom:PASS'])
    expect(rows.find((row) => row.app === 'Zoom')?.notes).toBe('second try')
  })
})

describe('SettingsStore with hotkeys', () => {
  it('persists hotkeys and falls back to defaults for a corrupt stored value', () => {
    const db = openDatabase(':memory:')
    const settings = new SettingsStore(db)
    expect(settings.get()).toEqual(DEFAULT_SETTINGS)

    settings.update({ hotkeys: { ...DEFAULT_SETTINGS.hotkeys, panicHide: 'Ctrl+Shift+P' } })
    expect(settings.get().hotkeys.panicHide).toBe('Ctrl+Shift+P')

    db.prepare("UPDATE settings SET value = ? WHERE key = 'hotkeys'").run('{"panicHide":"nope"}')
    expect(settings.get().hotkeys).toEqual(DEFAULT_SETTINGS.hotkeys)
  })
})
