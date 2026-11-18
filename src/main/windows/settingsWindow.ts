import { join } from 'node:path'
import { BrowserWindow, app } from 'electron'
import { SECURE_WEB_PREFERENCES, devRendererUrl, lockDownNavigation, rendererFileUrl } from '../security'

let settingsWindow: BrowserWindow | null = null

export function showSettingsWindow(): BrowserWindow {
  if (settingsWindow !== null && !settingsWindow.isDestroyed()) {
    settingsWindow.show()
    settingsWindow.focus()
    return settingsWindow
  }

  const win = new BrowserWindow({
    width: 920,
    height: 640,
    minWidth: 720,
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
  })

  const dev = devRendererUrl()
  void (dev !== null ? win.loadURL(`${dev}/index.html`) : win.loadURL(rendererFileUrl('index.html')))

  settingsWindow = win
  return win
}
