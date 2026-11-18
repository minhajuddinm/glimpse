import type { EventChannel, InvokeChannel, IpcRequestInput, IpcResponse } from '../shared/ipc'

export interface GlimpseApi {
  invoke<C extends InvokeChannel>(channel: C, request: IpcRequestInput<C>): Promise<IpcResponse<C>>
  /**
   * Subscribes to a main → renderer event. The payload is untrusted until the
   * renderer validates it against ipcEvents[channel]. Returns an unsubscribe function.
   */
  on(channel: EventChannel, listener: (payload: unknown) => void): () => void
  /** Streams one 100 ms audio chunk to main. Only accepted from the hidden capture page. */
  sendAudio(source: 'them' | 'you', samples: Float32Array, rms: number): void
}
