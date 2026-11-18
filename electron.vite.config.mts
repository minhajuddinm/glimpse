import { resolve } from 'node:path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  main: {
    build: {
      rolldownOptions: {
        input: { index: resolve(import.meta.dirname, 'src/main/index.ts') }
      }
    }
  },
  preload: {
    build: {
      rolldownOptions: {
        input: { index: resolve(import.meta.dirname, 'src/preload/index.ts') }
      }
    }
  },
  renderer: {
    root: resolve(import.meta.dirname, 'src/renderer'),
    plugins: [react(), tailwindcss()],
    build: {
      rolldownOptions: {
        input: {
          index: resolve(import.meta.dirname, 'src/renderer/index.html'),
          overlay: resolve(import.meta.dirname, 'src/renderer/overlay.html')
        }
      }
    }
  }
})
