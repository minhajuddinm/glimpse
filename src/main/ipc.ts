import { ipcMain, type IpcMainInvokeEvent } from 'electron'
import { ipcContract, type InvokeChannel, type IpcRequest, type IpcResponse } from '../shared/ipc'

export type SenderCheck = (event: IpcMainInvokeEvent) => boolean

type Handler<C extends InvokeChannel> = (
  request: IpcRequest<C>,
  event: IpcMainInvokeEvent
) => IpcResponse<C> | Promise<IpcResponse<C>>

/**
 * Registers an invoke handler. Rejects untrusted senders, validates the request
 * before the handler sees it, and validates the response before it leaves main.
 */
export function registerHandler<C extends InvokeChannel>(
  channel: C,
  isTrustedSender: SenderCheck,
  handler: Handler<C>
): void {
  const contract = ipcContract[channel]
  ipcMain.handle(channel, async (event, raw: unknown) => {
    if (!isTrustedSender(event)) {
      throw new Error(`Rejected IPC from untrusted sender on ${channel}`)
    }
    const request = contract.request.parse(raw) as IpcRequest<C>
    const response = await handler(request, event)
    return contract.response.parse(response)
  })
}
