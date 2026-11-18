import { z } from 'zod'
import { HOTKEY_ACTIONS, HotkeysSchema } from './accelerator'
import {
  LiveReportSchema,
  LiveStatusSchema,
  MatrixRowSchema,
  OverlayStateSchema,
  ProtectionStatusSchema,
  RectSchema,
  RemoteInfoSchema,
  SelfTestResultSchema
} from './capture'
import { SettingsPatchSchema, SettingsSchema } from './settings'

export const AppInfoSchema = z.object({
  name: z.string(),
  version: z.string(),
  electron: z.string(),
  platform: z.string(),
  windowsBuild: z.number().int().nullable()
})
export type AppInfo = z.infer<typeof AppInfoSchema>

export const HotkeyResultSchema = z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(true), hotkeys: HotkeysSchema }),
  z.object({ ok: z.literal(false), error: z.string(), hotkeys: HotkeysSchema })
])
export type HotkeyResult = z.infer<typeof HotkeyResultSchema>

/**
 * Single source of truth for every renderer → main invoke channel.
 * Main validates the request and the response against these schemas.
 */
export const ipcContract = {
  'app:info': { request: z.null(), response: AppInfoSchema },
  'settings:get': { request: z.null(), response: SettingsSchema },
  'settings:update': { request: SettingsPatchSchema, response: SettingsSchema },
  'hotkeys:set': {
    request: z.object({ action: z.enum(HOTKEY_ACTIONS), accelerator: z.string().max(64) }),
    response: HotkeyResultSchema
  },
  'hotkeys:status': {
    request: z.null(),
    response: z.object({ failures: z.partialRecord(z.enum(HOTKEY_ACTIONS), z.string()) })
  },
  'overlay:state': { request: z.null(), response: OverlayStateSchema },
  'overlay:hitRects': { request: z.object({ rects: z.array(RectSchema).max(32) }), response: z.null() },
  'overlay:canaryAck': { request: z.object({ on: z.boolean() }), response: z.null() },
  'protection:status': { request: z.null(), response: ProtectionStatusSchema },
  'selftest:run': { request: z.null(), response: SelfTestResultSchema },
  'selftest:last': { request: z.null(), response: SelfTestResultSchema.nullable() },
  'live:start': { request: z.object({ seconds: z.number().int().min(5).max(300) }), response: LiveStatusSchema },
  'live:control': { request: z.object({ seconds: z.number().int().min(3).max(30) }), response: LiveStatusSchema },
  'live:get': { request: z.null(), response: LiveStatusSchema },
  'live:stop': { request: z.null(), response: LiveStatusSchema },
  'env:remote': { request: z.null(), response: RemoteInfoSchema },
  'live:report': { request: LiveReportSchema, response: z.array(MatrixRowSchema) },
  'live:matrix': { request: z.null(), response: z.array(MatrixRowSchema) }
} as const satisfies Record<string, { request: z.ZodType; response: z.ZodType }>

/** Main → renderer pushes. */
export const ipcEvents = {
  'overlay:state': OverlayStateSchema,
  'overlay:canary': z.object({ on: z.boolean() }),
  'settings:changed': SettingsSchema,
  'live:status': LiveStatusSchema
} as const satisfies Record<string, z.ZodType>

export type IpcContract = typeof ipcContract
export type InvokeChannel = keyof IpcContract
/** What the renderer sends. */
export type IpcRequestInput<C extends InvokeChannel> = z.input<IpcContract[C]['request']>
/** What a main-process handler receives after validation. */
export type IpcRequest<C extends InvokeChannel> = z.output<IpcContract[C]['request']>
export type IpcResponse<C extends InvokeChannel> = z.output<IpcContract[C]['response']>

export type EventChannel = keyof typeof ipcEvents
export type EventPayload<E extends EventChannel> = z.output<(typeof ipcEvents)[E]>
