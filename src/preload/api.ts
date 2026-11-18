import type { InvokeChannel, IpcRequestInput, IpcResponse } from '../shared/ipc'

export interface GlimpseApi {
  invoke<C extends InvokeChannel>(channel: C, request: IpcRequestInput<C>): Promise<IpcResponse<C>>
}
