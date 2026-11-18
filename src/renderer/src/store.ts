import { create } from 'zustand'
import type { AppInfo } from '../../shared/ipc'
import type { Settings, SettingsPatch } from '../../shared/settings'

interface SettingsState {
  info: AppInfo | null
  settings: Settings | null
  error: string | null
  load: () => Promise<void>
  update: (patch: SettingsPatch) => Promise<void>
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export const useSettingsStore = create<SettingsState>((set) => ({
  info: null,
  settings: null,
  error: null,
  load: async () => {
    try {
      const [info, settings] = await Promise.all([
        window.glimpse.invoke('app:info', null),
        window.glimpse.invoke('settings:get', null)
      ])
      set({ info, settings, error: null })
    } catch (error) {
      set({ error: message(error) })
    }
  },
  update: async (patch) => {
    try {
      const settings = await window.glimpse.invoke('settings:update', patch)
      set({ settings, error: null })
    } catch (error) {
      set({ error: message(error) })
    }
  }
}))
