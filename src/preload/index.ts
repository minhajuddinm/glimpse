import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import { EVENT_CHANNELS, INVOKE_CHANNELS } from '../shared/channels'
import type { EventChannel, InvokeChannel, IpcRequestInput, IpcResponse } from '../shared/ipc'
import type { GlimpseApi } from './api'

const allowedInvoke: ReadonlySet<string> = new Set(INVOKE_CHANNELS)
const allowedEvents: ReadonlySet<string> = new Set(EVENT_CHANNELS)

const api: GlimpseApi = {
  invoke<C extends InvokeChannel>(channel: C, request: IpcRequestInput<C>): Promise<IpcResponse<C>> {
    if (!allowedInvoke.has(channel)) {
      return Promise.reject(new Error(`Blocked IPC channel: ${channel}`))
    }
    return ipcRenderer.invoke(channel, request) as Promise<IpcResponse<C>>
  },
  on(channel: EventChannel, listener: (payload: unknown) => void): () => void {
    if (!allowedEvents.has(channel)) throw new Error(`Blocked IPC event: ${channel}`)
    const handler = (_event: IpcRendererEvent, payload: unknown): void => {
      listener(payload)
    }
    ipcRenderer.on(channel, handler)
    return () => {
      ipcRenderer.removeListener(channel, handler)
    }
  }
}

contextBridge.exposeInMainWorld('glimpse', api)
