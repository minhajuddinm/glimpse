/**
 * Uses build/icon-source.png when present (the chosen logo), otherwise renders build/icon.svg, to the PNG and ICO files the app and installer use.
 * Runs inside Electron (Chromium rasterises the SVG): npm run icons
 */
const { app, BrowserWindow, nativeImage } = require('electron')
const { readFileSync, writeFileSync, mkdirSync } = require('node:fs')
const { join } = require('node:path')

const root = join(__dirname, '..')
const svg = readFileSync(join(root, 'build/icon.svg'), 'utf8')
const ICO_SIZES = [16, 24, 32, 48, 64, 128, 256]

async function render(win, size) {
  const html = `<html><body style="margin:0;background:transparent">${svg.replace('<svg ', `<svg width="${size}" height="${size}" `)}</body></html>`
  await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)
  const image = await win.webContents.capturePage({ x: 0, y: 0, width: size, height: size })
  return image.resize({ width: size, height: size, quality: 'best' }).toPNG()
}

/** ICO container holding PNG images (supported since Windows Vista). */
function ico(pngs) {
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0)
  header.writeUInt16LE(1, 2)
  header.writeUInt16LE(pngs.length, 4)
  const entries = []
  let offset = 6 + 16 * pngs.length
  for (const { size, png } of pngs) {
    const entry = Buffer.alloc(16)
    entry.writeUInt8(size >= 256 ? 0 : size, 0)
    entry.writeUInt8(size >= 256 ? 0 : size, 1)
    entry.writeUInt16LE(1, 4)
    entry.writeUInt16LE(32, 6)
    entry.writeUInt32LE(png.length, 8)
    entry.writeUInt32LE(offset, 12)
    offset += png.length
    entries.push(entry)
  }
  return Buffer.concat([header, ...entries, ...pngs.map((p) => p.png)])
}

app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 512, height: 512, show: false, transparent: true, frame: false, webPreferences: { offscreen: true } })
  mkdirSync(join(root, 'resources'), { recursive: true })
  let master
  const source = join(root, 'build/icon-source.png')
  if (require('node:fs').existsSync(source)) {
    master = readFileSync(source)
    writeFileSync(join(root, 'build/icon.png'), master)
  } else try {
    master = await render(win, 512)
    writeFileSync(join(root, 'build/icon.png'), master)
  } catch (error) {
    // Offscreen capture is occasionally refused by the GPU process; reuse the last good master.
    console.warn('render failed, using existing build/icon.png:', String(error))
    master = readFileSync(join(root, 'build/icon.png'))
  }
  const image = nativeImage.createFromBuffer(master)
  const at = (size) => image.resize({ width: size, height: size, quality: 'best' }).toPNG()
  writeFileSync(join(root, 'build/icon.ico'), ico(ICO_SIZES.map((size) => ({ size, png: at(size) }))))
  writeFileSync(join(root, 'resources/icon.png'), at(256))
  writeFileSync(join(root, 'resources/tray.png'), at(16))
  writeFileSync(join(root, 'resources/tray@2x.png'), at(32))
  console.log('ICONS written')
  app.exit(0)
}).catch((error) => {
  console.error(error)
  app.exit(1)
})
