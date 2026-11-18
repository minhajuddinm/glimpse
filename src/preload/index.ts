import { contextBridge, ipcRenderer } from 'electron'
import { INVOKE_CHANNELS } from '../shared/channels'
import type { InvokeChannel, IpcRequestInput, IpcResponse } from '../shared/ipc'
import type { GlimpseApi } from './api'

const allowed: ReadonlySet<string> = new Set(INVOKE_CHANNELS)

const api: GlimpseApi = {
  invoke<C extends InvokeChannel>(channel: C, request: IpcRequestInput<C>): Promise<IpcResponse<C>> {
    if (!allowed.has(channel)) {
      return Promise.reject(new Error(`Blocked IPC channel: ${channel}`))
    }
    return ipcRenderer.invoke(channel, request) as Promise<IpcResponse<C>>
  }
}

contextBridge.exposeInMainWorld('glimpse', api)
