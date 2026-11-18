import { create } from 'zustand'
import type { AppInfo } from '../../shared/ipc'
import type { Settings, SettingsPatch } from '../../shared/settings'
import { errorMessage, subscribe } from './ipc'

interface SettingsState {
  info: AppInfo | null
  settings: Settings | null
  error: string | null
  /** Loads settings and keeps them in sync with changes made elsewhere (hotkeys, overlay). Returns unsubscribe. */
  init: () => () => void
  update: (patch: SettingsPatch) => Promise<void>
}

export const useSettingsStore = create<SettingsState>((set) => ({
  info: null,
  settings: null,
  error: null,
  init: () => {
    void Promise.all([window.glimpse.invoke('app:info', null), window.glimpse.invoke('settings:get', null)]).then(
      ([info, settings]) => {
        set({ info, settings, error: null })
      },
      (error: unknown) => {
        set({ error: errorMessage(error) })
      }
    )
    return subscribe('settings:changed', (settings) => {
      set({ settings })
    })
  },
  update: async (patch) => {
    try {
      const settings = await window.glimpse.invoke('settings:update', patch)
      set({ settings, error: null })
    } catch (error) {
      set({ error: errorMessage(error) })
    }
  }
}))
