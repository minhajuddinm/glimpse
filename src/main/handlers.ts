import { app } from 'electron'
import type { SelfTestResult } from '../shared/capture'
import { broadcast } from './broadcast'
import type { HotkeyManager } from './hotkeys'
import { registerHandler } from './ipc'
import type { OverlayController } from './overlay'
import { isTrustedSender } from './security'
import { detectRemoteViewers } from './remote'
import type { LiveSession } from './selftest/live'
import type { CaptureStore } from './selftest/store'
import type { SettingsStore } from './settingsStore'

export interface HandlerContext {
  readonly settings: SettingsStore
  readonly overlay: OverlayController
  readonly hotkeys: HotkeyManager
  readonly captureStore: CaptureStore
  readonly live: LiveSession
  readonly windowsBuild: number | null
  readonly runSelfTest: () => Promise<SelfTestResult>
}

export function registerAllHandlers(ctx: HandlerContext): void {
  const { settings, overlay, hotkeys, captureStore, live } = ctx
  let selfTestRun: Promise<SelfTestResult> | null = null

  registerHandler('app:info', isTrustedSender, () => ({
    name: app.getName(),
    version: app.getVersion(),
    electron: process.versions.electron,
    platform: process.platform,
    windowsBuild: ctx.windowsBuild
  }))

  registerHandler('settings:get', isTrustedSender, () => settings.get())

  registerHandler('settings:update', isTrustedSender, (patch) => {
    const next = settings.update(patch)
    // In development this would register the bare electron.exe as a startup app.
    if (app.isPackaged) app.setLoginItemSettings({ openAtLogin: next.launchAtLogin })
    overlay.applySettings()
    broadcast('settings:changed', next)
    return next
  })

  registerHandler('hotkeys:set', isTrustedSender, ({ action, accelerator }) => {
    const result = hotkeys.rebind(action, accelerator, settings.get().hotkeys)
    if (result.ok) {
      const next = settings.update({ hotkeys: result.hotkeys })
      broadcast('settings:changed', next)
    }
    return result
  })

  registerHandler('hotkeys:status', isTrustedSender, () => ({ failures: hotkeys.failures() }))

  registerHandler('overlay:state', isTrustedSender, () => overlay.state())

  registerHandler('overlay:hitRects', isTrustedSender, ({ rects }) => {
    overlay.setHitRects(rects)
    return null
  })

  registerHandler('overlay:canaryAck', isTrustedSender, ({ on }) => {
    overlay.ackCanary(on)
    return null
  })

  registerHandler('protection:status', isTrustedSender, () => overlay.protectionStatus())

  registerHandler('selftest:run', isTrustedSender, async () => {
    // One run at a time: the test hides, paints and briefly unprotects the overlay.
    selfTestRun ??= (async () => {
      await live.stop()
      const result = await ctx.runSelfTest()
      captureStore.saveSelfTest(result)
      return result
    })().finally(() => {
      selfTestRun = null
    })
    return selfTestRun
  })

  registerHandler('selftest:last', isTrustedSender, () => captureStore.lastSelfTest())

  registerHandler('live:start', isTrustedSender, ({ seconds }) => live.start(seconds))
  registerHandler('live:control', isTrustedSender, ({ seconds }) => live.control(seconds))
  registerHandler('live:get', isTrustedSender, () => live.status())
  registerHandler('live:stop', isTrustedSender, () => live.stop())
  registerHandler('env:remote', isTrustedSender, () => detectRemoteViewers())

  registerHandler('live:report', isTrustedSender, (report) => {
    captureStore.saveMatrixRow({
      app: report.app,
      result: report.overlayVisible ? 'FAIL' : 'PASS',
      notes: report.notes,
      testedAt: new Date().toISOString(),
      windowsBuild: ctx.windowsBuild
    })
    return captureStore.matrix()
  })

  registerHandler('live:matrix', isTrustedSender, () => captureStore.matrix())
}
