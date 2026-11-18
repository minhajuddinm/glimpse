import { desktopCapturer, nativeImage, type Display } from 'electron'
import { SelfTestResultSchema, type SelfTestResult } from '../../shared/capture'
import type { OverlayController } from '../overlay'
import { sleep } from '../util'
import { GRID, analyzeCapture, judge, rectToPixels, renderDiff, type Bitmap } from './analyze'

const HIDE_SETTLE_MS = 250

/** Captures one display at its native pixel size, exactly as a screen recorder would. */
async function captureDisplay(display: Display): Promise<Bitmap> {
  const width = Math.round(display.bounds.width * display.scaleFactor)
  const height = Math.round(display.bounds.height * display.scaleFactor)
  const sources = await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize: { width, height },
    fetchWindowIcons: false
  })
  const source = sources.find((candidate) => candidate.display_id === String(display.id)) ?? sources[0]
  if (source === undefined) throw new Error('No screen source available to capture')
  const size = source.thumbnail.getSize()
  return { data: new Uint8Array(source.thumbnail.toBitmap()), width: size.width, height: size.height }
}

function toPngDataUrl(bitmap: Bitmap): string {
  const image = nativeImage.createFromBitmap(Buffer.from(bitmap.data), { width: bitmap.width, height: bitmap.height })
  return `data:image/png;base64,${image.toPNG().toString('base64')}`
}

/**
 * The A4 capture self-test.
 *
 *  1. Baseline: overlay hidden.
 *  2. Protected: overlay painted with the magenta/lime canary, protection ON. This is what a recorder sees.
 *  3. Control: same, protection briefly OFF. Proves the test can see the overlay at all.
 *
 * Overlay pixels are canary-coloured pixels that also differ from the baseline.
 * Protection is always restored and the canary cleared, even if a step throws.
 */
export async function runSelfTest(overlay: OverlayController): Promise<SelfTestResult> {
  const geometry = overlay.geometry()
  if (geometry === null) throw new Error('The overlay window does not exist yet')
  if (overlay.state().panic) throw new Error('Leave panic mode before running the self-test')

  const { display, bounds } = geometry
  const wasVisible = overlay.state().visible

  let baseline: Bitmap
  let protectedCapture: Bitmap
  let controlCapture: Bitmap
  try {
    overlay.hide()
    await sleep(HIDE_SETTLE_MS)
    baseline = await captureDisplay(display)

    await overlay.setCanary(true)
    overlay.show()
    await sleep(HIDE_SETTLE_MS)
    protectedCapture = await captureDisplay(display)

    await overlay.setProtection(false)
    try {
      controlCapture = await captureDisplay(display)
    } finally {
      await overlay.setProtection(true)
    }
  } finally {
    await overlay.setCanary(false)
    if (!wasVisible) overlay.hide()
  }

  const rect = rectToPixels(bounds, display.bounds, baseline)
  const protectedRun = analyzeCapture(protectedCapture, baseline, rect, GRID)
  const controlRun = analyzeCapture(controlCapture, baseline, rect, GRID)
  const { verdict, notes } = judge(protectedRun, controlRun)

  const protection = overlay.protectionStatus()
  if (!protection.verified) notes.push(`Windows did not confirm the protection setting: ${protection.detail}`)
  if (protection.method === 'monitor-only') {
    notes.push('Only WDA_MONITOR is available on this Windows version: recorders may show a black rectangle where the overlay is.')
  }

  return SelfTestResultSchema.parse({
    verdict,
    ranAt: new Date().toISOString(),
    displayId: display.id,
    scaleFactor: display.scaleFactor,
    overlayRectPx: rect,
    grid: GRID,
    protectedRegions: protectedRun.regions,
    controlDetectedFraction: controlRun.fraction,
    protection,
    notes,
    protectedImage: toPngDataUrl(renderDiff(protectedCapture, baseline, rect, protectedRun.regions, GRID)),
    controlImage: toPngDataUrl(renderDiff(controlCapture, baseline, rect, controlRun.regions, GRID))
  })
}
