import { release } from 'node:os'
import { join } from 'node:path'
import { app, type Tray } from 'electron'
import { openDatabase, type Db } from './db'
import { registerHandler } from './ipc'
import { isTrustedSender } from './security'
import { SettingsStore } from './settingsStore'
import { createTray } from './tray'
import { showSettingsWindow } from './windows/settingsWindow'

/** Windows build number from os.release() ("10.0.26100" → 26100), or null elsewhere. */
function windowsBuild(): number | null {
  if (process.platform !== 'win32') return null
  const build = Number(release().split('.')[2])
  return Number.isInteger(build) ? build : null
}

let db: Db | null = null
let tray: Tray | null = null

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    showSettingsWindow()
  })

  // Glimpse lives in the tray; closing the settings window must not quit it.
  app.on('window-all-closed', () => undefined)

  app.on('before-quit', () => {
    tray?.destroy()
    tray = null
    db?.close()
    db = null
  })

  void app.whenReady().then(() => {
    db = openDatabase(join(app.getPath('userData'), 'glimpse.db'))
    const settings = new SettingsStore(db)

    registerHandler('app:info', isTrustedSender, () => ({
      name: app.getName(),
      version: app.getVersion(),
      electron: process.versions.electron,
      platform: process.platform,
      windowsBuild: windowsBuild()
    }))
    registerHandler('settings:get', isTrustedSender, () => settings.get())
    registerHandler('settings:update', isTrustedSender, (patch) => {
      const next = settings.update(patch)
      app.setLoginItemSettings({ openAtLogin: next.launchAtLogin })
      return next
    })

    tray = createTray(() => {
      showSettingsWindow()
    })
    showSettingsWindow()
  })
}
