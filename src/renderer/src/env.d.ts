import type { GlimpseApi } from '../../preload/api'

declare global {
  interface Window {
    glimpse: GlimpseApi
  }
}

export {}
