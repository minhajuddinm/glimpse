import { invokeErrorMessage, ipcEvents, type EventChannel, type EventPayload } from '../../shared/ipc'

/** Subscribes to a main → renderer event, dropping any payload that fails validation. */
export function subscribe<E extends EventChannel>(
  channel: E,
  listener: (payload: EventPayload<E>) => void
): () => void {
  return window.glimpse.on(channel, (raw) => {
    const parsed = ipcEvents[channel].safeParse(raw)
    if (parsed.success) listener(parsed.data as EventPayload<E>)
  })
}

export function errorMessage(error: unknown): string {
  return invokeErrorMessage(error)
}
