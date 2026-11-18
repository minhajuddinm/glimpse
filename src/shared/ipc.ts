import { z } from 'zod'
import { SettingsPatchSchema, SettingsSchema } from './settings'

export const AppInfoSchema = z.object({
  name: z.string(),
  version: z.string(),
  electron: z.string(),
  platform: z.string(),
  windowsBuild: z.number().int().nullable()
})
export type AppInfo = z.infer<typeof AppInfoSchema>

/**
 * Single source of truth for every renderer → main invoke channel.
 * Main validates the request and the response against these schemas.
 */
export const ipcContract = {
  'app:info': { request: z.null(), response: AppInfoSchema },
  'settings:get': { request: z.null(), response: SettingsSchema },
  'settings:update': { request: SettingsPatchSchema, response: SettingsSchema }
} as const satisfies Record<string, { request: z.ZodType; response: z.ZodType }>

export type IpcContract = typeof ipcContract
export type InvokeChannel = keyof IpcContract
/** What the renderer sends. */
export type IpcRequestInput<C extends InvokeChannel> = z.input<IpcContract[C]['request']>
/** What a main-process handler receives after validation. */
export type IpcRequest<C extends InvokeChannel> = z.output<IpcContract[C]['request']>
export type IpcResponse<C extends InvokeChannel> = z.output<IpcContract[C]['response']>
