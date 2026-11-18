import { z } from 'zod'
import { DEFAULT_HOTKEYS, HotkeysSchema } from './accelerator'

export const ModeSchema = z.enum(['general', 'interview', 'sales', 'technical', 'recap'])
export type Mode = z.infer<typeof ModeSchema>

export const MIN_OVERLAY_OPACITY = 0.15

export const SettingsSchema = z.object({
  mode: ModeSchema,
  clickThrough: z.boolean(),
  overlayOpacity: z.number().min(MIN_OVERLAY_OPACITY).max(1),
  launchAtLogin: z.boolean(),
  hotkeys: HotkeysSchema,
  /** Microphone deviceId; null follows the Windows default input. */
  micDeviceId: z.string().max(256).nullable(),
  micMuted: z.boolean(),
  loopbackMuted: z.boolean(),
  asrModel: z.enum(['kroko-en', 'nemotron-0.6b']),
  /** Serve the companion page (transcript, later answers) to a second device. */
  companionEnabled: z.boolean(),
  /** Listen on the network (LAN / Tailscale) instead of only this PC. */
  companionLan: z.boolean(),
  /** Answer questions from the other side automatically (C1). */
  autoAnswer: z.boolean(),
  /** Check factual claims (numbers, dates, names) from the other side. */
  factCheck: z.boolean(),
  /** Which answer provider to use; auto prefers Anthropic, then Groq. */
  llmProvider: z.enum(['auto', 'anthropic', 'groq'])
})
export type Settings = z.infer<typeof SettingsSchema>
export type SettingKey = keyof Settings

/** What the renderer may change through settings:update. Hotkeys go through hotkeys:set. */
export const SettingsPatchSchema = SettingsSchema.omit({ hotkeys: true }).partial()
export type SettingsPatch = z.infer<typeof SettingsPatchSchema>

/** Any subset of settings; undefined values are ignored (zod partials yield `T | undefined`). */
export type SettingsUpdate = { [K in SettingKey]?: Settings[K] | undefined }

export const DEFAULT_SETTINGS: Settings = {
  mode: 'general',
  clickThrough: true,
  overlayOpacity: 1,
  launchAtLogin: false,
  micDeviceId: null,
  micMuted: false,
  loopbackMuted: false,
  asrModel: 'kroko-en',
  companionEnabled: false,
  companionLan: false,
  autoAnswer: true,
  factCheck: false,
  llmProvider: 'auto',
  hotkeys: DEFAULT_HOTKEYS
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
export function applySettingsPatch(current: Settings, patch: SettingsUpdate): Settings {
  const defined = Object.fromEntries(Object.entries(patch).filter(([, value]) => value !== undefined))
  return SettingsSchema.parse({ ...current, ...defined })
}
