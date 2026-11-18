import { mkdirSync, writeFileSync } from 'node:fs'
import { release, tmpdir } from 'node:os'
import { join } from 'node:path'
import { Notification, app, globalShortcut, type Tray } from 'electron'
import { broadcast } from './broadcast'
import { isHeadless, parseCli } from './cli'
import { openDatabase, type Db } from './db'
import { registerAllHandlers } from './handlers'
import { HotkeyManager } from './hotkeys'
import { OverlayController } from './overlay'
import { PanicController } from './panic'
import { LiveSession } from './selftest/live'
import { runSelfTest } from './selftest/run'
import { CaptureStore } from './selftest/store'
import { SettingsStore } from './settingsStore'
import { createTray } from './tray'
import { sleep } from './util'
import { showSettingsWindow } from './windows/settingsWindow'

const cli = parseCli(process.argv)
const headless = isHeadless(cli)

/** Windows build number from os.release() ("10.0.26100" → 26100), or null elsewhere. */
function windowsBuild(): number | null {
  if (process.platform !== 'win32') return null
  const build = Number(release().split('.')[2])
  return Number.isInteger(build) ? build : null
}

function noop(): void {
  // Headless runs have no hotkeys or live-status listeners.
}

function savePng(dataUrl: string | null, file: string): string | null {
  if (dataUrl === null) return null
  writeFileSync(file, Buffer.from(dataUrl.slice(dataUrl.indexOf(',') + 1), 'base64'))
  return file
}

/** `--selftest` and `--canary=N`: no windows, tray or hotkeys, and a throwaway profile. */
async function startHeadless(): Promise<void> {
  const db = openDatabase(join(app.getPath('userData'), 'glimpse.db'))
  const settings = new SettingsStore(db)
  const overlay = new OverlayController({
    windowsBuild: windowsBuild(),
    getSettings: () => settings.get(),
    onState: () => undefined
  })
  try {
    // The overlay page talks to main over IPC (canary acknowledgement, settings), so wire the same handlers.
    registerAllHandlers({
      settings,
      overlay,
      hotkeys: new HotkeyManager(globalShortcut, { toggleOverlay: noop, toggleClickThrough: noop, panicHide: noop }),
      captureStore: new CaptureStore(db),
      live: new LiveSession(overlay, noop),
      windowsBuild: windowsBuild(),
      runSelfTest: () => runSelfTest(overlay)
    })
    await overlay.create()
    overlay.show()

    if (cli.canarySeconds !== null) {
      await overlay.setCanary(true)
      console.log(`CANARY_ON seconds=${cli.canarySeconds} ${overlay.protectionStatus().detail}`)
      await sleep(cli.canarySeconds * 1000)
      await overlay.setCanary(false)
      app.exit(0)
      return
    }

    const result = await runSelfTest(overlay)
    const dir = join(tmpdir(), 'glimpse-selftest')
    mkdirSync(dir, { recursive: true })
    const summary = {
      verdict: result.verdict,
      failingRegions: result.protectedRegions.filter((region) => region.status === 'FAIL').length,
      totalRegions: result.protectedRegions.length,
      protectedCanaryPixels: result.protectedRegions.reduce((sum, region) => sum + region.canaryPixels, 0),
      controlDetectedFraction: Number(result.controlDetectedFraction.toFixed(4)),
      protection: result.protection,
      notes: result.notes,
      protectedImage: savePng(result.protectedImage, join(dir, 'protected.png')),
      controlImage: savePng(result.controlImage, join(dir, 'control.png'))
    }
    console.log(`SELFTEST_RESULT ${JSON.stringify(summary)}`)
    app.exit(result.verdict === 'PASS' ? 0 : 1)
  } catch (error) {
    console.error('SELFTEST_ERROR', error)
    app.exit(2)
  } finally {
    overlay.destroy()
    db.close()
  }
}

let db: Db | null = null
let tray: Tray | null = null

async function startNormal(): Promise<void> {
  db = openDatabase(join(app.getPath('userData'), 'glimpse.db'))
  const settings = new SettingsStore(db)
  const captureStore = new CaptureStore(db)

  const overlay = new OverlayController({
    windowsBuild: windowsBuild(),
    getSettings: () => settings.get(),
    onState: (state) => {
      broadcast('overlay:state', state)
    }
  })

  const showTray = (): void => {
    tray ??= createTray({
      onOpenSettings: () => {
        showSettingsWindow()
      },
      onToggleOverlay: () => {
        overlay.toggle()
      }
    })
  }
  const hideTray = (): void => {
    tray?.destroy()
    tray = null
  }

  const live = new LiveSession(overlay, (status) => {
    broadcast('live:status', status)
  })
  const panic = new PanicController({
    overlay,
    hideTray,
    showTray,
    stopLive: () => {
      live.stop().catch((error: unknown) => {
        console.error('[live] stop failed', error)
      })
    }
  })

  const hotkeys = new HotkeyManager(globalShortcut, {
    toggleOverlay: () => {
      overlay.toggle()
    },
    toggleClickThrough: () => {
      const next = settings.update({ clickThrough: !settings.get().clickThrough })
      overlay.applySettings()
      broadcast('settings:changed', next)
    },
    panicHide: () => {
      panic.toggle()
    }
  })

  registerAllHandlers({
    settings,
    overlay,
    hotkeys,
    captureStore,
    live,
    windowsBuild: windowsBuild(),
    runSelfTest: () => runSelfTest(overlay)
  })

  app.on('before-quit', () => {
    hotkeys.dispose()
    overlay.destroy()
    hideTray()
    db?.close()
    db = null
  })

  await overlay.create()
  const failures = hotkeys.applyAll(settings.get().hotkeys)
  const failedReasons = Object.entries(failures)
  for (const [action, reason] of failedReasons) console.warn(`[hotkeys] ${action}: ${reason}`)
  if (failedReasons.length > 0 && Notification.isSupported()) {
    // A dead panic key must never be silent.
    new Notification({
      title: 'Glimpse: a hotkey is not working',
      body: `${failedReasons.map(([, reason]) => reason).join(' ')} Change it in Settings → Hotkeys.`
    }).show()
  }
  showTray()
  overlay.show()
  showSettingsWindow()
}

if (headless) {
  // A throwaway profile keeps the headless run from touching (or being blocked by) the real app.
  app.setPath('userData', join(tmpdir(), 'glimpse-headless'))
  void app.whenReady().then(startHeadless)
  app.on('window-all-closed', () => undefined)
} else if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    showSettingsWindow()
  })
  // Glimpse lives in the tray; closing the settings window must not quit it.
  app.on('window-all-closed', () => undefined)
  void app.whenReady().then(startNormal)
}
