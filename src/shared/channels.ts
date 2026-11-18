import type { EventChannel, InvokeChannel } from './ipc'

/**
 * Channel allow-lists for the preload bridge. Kept free of runtime imports so the
 * sandboxed preload bundle does not pull in zod. A unit test keeps them in sync
 * with ipcContract / ipcEvents.
 */
export const INVOKE_CHANNELS = [
  'app:info',
  'settings:get',
  'settings:update',
  'hotkeys:set',
  'hotkeys:status',
  'overlay:state',
  'overlay:hitRects',
  'overlay:canaryAck',
  'protection:status',
  'selftest:run',
  'selftest:last',
  'live:start',
  'live:control',
  'live:get',
  'live:stop',
  'env:remote',
  'live:report',
  'live:matrix',
  'capture:config',
  'capture:report',
  'audio:status',
  'audio:devices',
  'audio:retry',
  'transcript:get',
  'transcript:clear',
  'companion:info',
  'companion:regenerate'
] as const satisfies readonly InvokeChannel[]

export const EVENT_CHANNELS = [
  'overlay:state',
  'overlay:canary',
  'settings:changed',
  'live:status',
  'capture:control',
  'audio:status',
  'audio:levels',
  'transcript:update',
  'companion:info'
] as const satisfies readonly EventChannel[]
