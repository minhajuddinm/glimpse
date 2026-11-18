import { Menu, Tray, app, nativeImage, type NativeImage } from 'electron'

const SIZE = 16
const VIOLET = { r: 0x8b, g: 0x5c, b: 0xf6 }

/** Draws an anti-aliased violet dot so the tray needs no image asset. */
function trayIcon(): NativeImage {
  const pixels = Buffer.alloc(SIZE * SIZE * 4)
  const centre = (SIZE - 1) / 2
  const radius = SIZE / 2 - 2
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const distance = Math.hypot(x - centre, y - centre)
      const alpha = Math.max(0, Math.min(1, radius + 0.5 - distance))
      const offset = (y * SIZE + x) * 4
      // Electron expects BGRA bitmap data.
      pixels[offset] = VIOLET.b
      pixels[offset + 1] = VIOLET.g
      pixels[offset + 2] = VIOLET.r
      pixels[offset + 3] = Math.round(alpha * 255)
    }
  }
  return nativeImage.createFromBitmap(pixels, { width: SIZE, height: SIZE })
}

export interface TrayActions {
  readonly onOpenSettings: () => void
  readonly onToggleOverlay: () => void
}

export function createTray(actions: TrayActions): Tray {
  const tray = new Tray(trayIcon())
  tray.setToolTip('Glimpse')
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Show / hide overlay', click: actions.onToggleOverlay },
      { label: 'Settings', click: actions.onOpenSettings },
      { type: 'separator' },
      { label: 'Quit Glimpse', click: () => { app.quit() } }
    ])
  )
  tray.on('click', actions.onOpenSettings)
  return tray
}
