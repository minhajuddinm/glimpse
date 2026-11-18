import { BrowserWindow } from 'electron'
import { ipcEvents, type EventChannel, type EventPayload } from '../shared/ipc'

/** Sends a validated event to every open Glimpse window. */
export function broadcast<E extends EventChannel>(channel: E, payload: EventPayload<E>): void {
  const valid = ipcEvents[channel].parse(payload)
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(channel, valid)
  }
}
