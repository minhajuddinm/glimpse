import { join } from 'node:path'
import { BrowserWindow, Notification, app } from 'electron'
import { SECURE_WEB_PREFERENCES, devRendererUrl, lockDownNavigation, rendererFileUrl } from '../security'

let settingsWindow: BrowserWindow | null = null
let closeNoticeShown = false

export function showSettingsWindow(): BrowserWindow {
  if (settingsWindow !== null && !settingsWindow.isDestroyed()) {
    settingsWindow.show()
    settingsWindow.focus()
    return settingsWindow
  }

  const win = new BrowserWindow({
    width: 1080,
    height: 740,
    minWidth: 900,
    minHeight: 520,
    show: false,
    title: 'Glimpse',
    backgroundColor: '#0b0b12',
    autoHideMenuBar: true,
    icon: join(app.getAppPath(), 'resources', 'icon.png'),
    webPreferences: {
      ...SECURE_WEB_PREFERENCES,
      preload: join(__dirname, '../preload/index.js')
    }
  })
  lockDownNavigation(win)
  win.once('ready-to-show', () => {
    win.show()
  })
  win.on('closed', () => {
    settingsWindow = null
    // Closing Settings does not quit Glimpse; say so once per run.
    if (!closeNoticeShown && Notification.isSupported()) {
      closeNoticeShown = true
      new Notification({
        title: 'Glimpse is still running',
        body: 'It keeps listening in the background. Open it again from the tray icon, or quit it there.',
        icon: join(app.getAppPath(), 'resources', 'icon.png')
      }).show()
    }
  })

  const dev = devRendererUrl()
  void (dev !== null ? win.loadURL(`${dev}/index.html`) : win.loadURL(rendererFileUrl('index.html')))

  settingsWindow = win
  return win
}
