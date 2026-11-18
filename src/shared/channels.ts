import type { InvokeChannel } from './ipc'

/**
 * Channel allow-list for the preload bridge. Kept free of runtime imports so the
 * sandboxed preload bundle does not pull in zod. A unit test keeps it in sync
 * with ipcContract.
 */
export const INVOKE_CHANNELS = ['app:info', 'settings:get', 'settings:update'] as const satisfies readonly InvokeChannel[]
