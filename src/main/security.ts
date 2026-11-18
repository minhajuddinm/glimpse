import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { BrowserWindow, IpcMainInvokeEvent } from 'electron'

/** Dev server URL injected by electron-vite in development, otherwise null. */
export function devRendererUrl(): string | null {
  const url = process.env['ELECTRON_RENDERER_URL']
  return url !== undefined && url.length > 0 ? url : null
}

export function rendererFileUrl(page: string): string {
  return pathToFileURL(join(__dirname, '../renderer', page)).href
}

/** True only for frames loaded from Glimpse's own renderer bundle. */
export function isTrustedSender(event: IpcMainInvokeEvent): boolean {
  const url = event.senderFrame?.url
  if (url === undefined) return false
  const dev = devRendererUrl()
  if (dev !== null) return url.startsWith(dev)
  return url.startsWith(pathToFileURL(join(__dirname, '../renderer')).href)
}

/** Blocks new windows and navigation away from the app's own pages. */
export function lockDownNavigation(win: BrowserWindow): void {
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  win.webContents.on('will-navigate', (event, url) => {
    const dev = devRendererUrl()
    const allowedPrefix = dev ?? pathToFileURL(join(__dirname, '../renderer')).href
    if (!url.startsWith(allowedPrefix)) event.preventDefault()
  })
}

export const SECURE_WEB_PREFERENCES = {
  sandbox: true,
  contextIsolation: true,
  nodeIntegration: false,
  webSecurity: true,
  spellcheck: false
} as const
