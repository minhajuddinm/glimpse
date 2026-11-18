import { z } from 'zod'

export const ModeSchema = z.enum(['general', 'interview', 'sales', 'technical', 'recap'])
export type Mode = z.infer<typeof ModeSchema>

export const SettingsSchema = z.object({
  mode: ModeSchema,
  clickThrough: z.boolean(),
  overlayOpacity: z.number().min(0.15).max(1),
  launchAtLogin: z.boolean()
})
export type Settings = z.infer<typeof SettingsSchema>
export type SettingKey = keyof Settings

export const SettingsPatchSchema = SettingsSchema.partial()
export type SettingsPatch = z.infer<typeof SettingsPatchSchema>

export const DEFAULT_SETTINGS: Settings = {
  mode: 'general',
  clickThrough: true,
  overlayOpacity: 1,
  launchAtLogin: false
}

const SETTING_KEYS = Object.keys(SettingsSchema.shape) as SettingKey[]

/**
 * Builds a valid Settings object from untrusted stored values.
 * Each field is validated on its own, so one corrupt value falls back to its
 * default without discarding the rest.
 */
export function mergeStoredSettings(stored: Readonly<Record<string, unknown>>): Settings {
  const merged: Record<string, unknown> = { ...DEFAULT_SETTINGS }
  for (const key of SETTING_KEYS) {
    if (!Object.hasOwn(stored, key)) continue
    const parsed = SettingsSchema.shape[key].safeParse(stored[key])
    if (parsed.success) merged[key] = parsed.data
  }
  return SettingsSchema.parse(merged)
}

/** Applies a validated patch, ignoring keys whose value is undefined. */
export function applySettingsPatch(current: Settings, patch: SettingsPatch): Settings {
  const defined = Object.fromEntries(Object.entries(patch).filter(([, value]) => value !== undefined))
  return SettingsSchema.parse({ ...current, ...defined })
}
