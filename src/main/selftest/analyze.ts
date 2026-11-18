import type { Rect, RegionResult, Verdict } from '../../shared/capture'

/** BGRA, 4 bytes per pixel, row-major: the layout Electron's NativeImage.toBitmap() returns on Windows. */
export interface Bitmap {
  readonly data: Uint8Array
  readonly width: number
  readonly height: number
}

export interface Grid {
  readonly cols: number
  readonly rows: number
}

export const GRID: Grid = { cols: 2, rows: 6 }

/** A region fails if more than this fraction of its pixels show the canary. */
export const REGION_FAIL_FRACTION = 0.001
/** The control capture must show at least this fraction of the overlay, or the test proves nothing. */
export const CONTROL_DETECT_FRACTION = 0.5

const CANARY_TOLERANCE = 48
const CHANGE_THRESHOLD = 60

const MARK_CANARY: readonly number[] = [0, 0, 255, 255]
const BORDER_PASS: readonly number[] = [94, 197, 34, 255]
const BORDER_FAIL: readonly number[] = [0, 215, 255, 255]

/** The two canary colours: magenta and lime. Both are rare in real desktops. */
export function isCanaryPixel(b: number, g: number, r: number): boolean {
  const t = CANARY_TOLERANCE
  const magenta = r >= 255 - t && g <= t && b >= 255 - t
  const lime = r <= t && g >= 255 - t && b <= t
  return magenta || lime
}

/** True if the capture differs from the baseline: separates the overlay from wallpaper that happens to be magenta/lime. */
function differsFromBaseline(capture: Uint8Array, baseline: Uint8Array, offset: number): boolean {
  const delta =
    Math.abs((capture[offset] ?? 0) - (baseline[offset] ?? 0)) +
    Math.abs((capture[offset + 1] ?? 0) - (baseline[offset + 1] ?? 0)) +
    Math.abs((capture[offset + 2] ?? 0) - (baseline[offset + 2] ?? 0))
  return delta > CHANGE_THRESHOLD
}

function isOverlayPixel(capture: Uint8Array, baseline: Uint8Array, offset: number): boolean {
  return (
    isCanaryPixel(capture[offset] ?? 0, capture[offset + 1] ?? 0, capture[offset + 2] ?? 0) &&
    differsFromBaseline(capture, baseline, offset)
  )
}

/** Converts a DIP rectangle on a display to pixel coordinates in a capture of that display. */
export function rectToPixels(boundsDip: Rect, displayBoundsDip: Rect, capture: { width: number; height: number }): Rect {
  const sx = capture.width / displayBoundsDip.width
  const sy = capture.height / displayBoundsDip.height
  const x = Math.max(0, Math.round((boundsDip.x - displayBoundsDip.x) * sx))
  const y = Math.max(0, Math.round((boundsDip.y - displayBoundsDip.y) * sy))
  const right = Math.min(capture.width, Math.round((boundsDip.x - displayBoundsDip.x + boundsDip.width) * sx))
  const bottom = Math.min(capture.height, Math.round((boundsDip.y - displayBoundsDip.y + boundsDip.height) * sy))
  return { x, y, width: Math.max(0, right - x), height: Math.max(0, bottom - y) }
}

export interface Analysis {
  readonly regions: RegionResult[]
  readonly canaryPixels: number
  readonly totalPixels: number
  /** Fraction of the overlay rectangle showing the canary. */
  readonly fraction: number
}

function assertSameSize(a: Bitmap, b: Bitmap): void {
  if (a.width !== b.width || a.height !== b.height) {
    throw new Error(`Capture size mismatch: ${a.width}x${a.height} vs ${b.width}x${b.height}`)
  }
}

/** Counts canary pixels (that differ from the baseline) per grid region of the overlay rectangle. */
export function analyzeCapture(capture: Bitmap, baseline: Bitmap, rect: Rect, grid: Grid): Analysis {
  assertSameSize(capture, baseline)
  const counts = new Array<number>(grid.cols * grid.rows).fill(0)
  const totals = new Array<number>(grid.cols * grid.rows).fill(0)
  for (let y = 0; y < rect.height; y++) {
    const row = Math.min(grid.rows - 1, Math.floor((y * grid.rows) / rect.height))
    for (let x = 0; x < rect.width; x++) {
      const col = Math.min(grid.cols - 1, Math.floor((x * grid.cols) / rect.width))
      const index = row * grid.cols + col
      totals[index] = (totals[index] ?? 0) + 1
      const offset = ((rect.y + y) * capture.width + (rect.x + x)) * 4
      if (isOverlayPixel(capture.data, baseline.data, offset)) counts[index] = (counts[index] ?? 0) + 1
    }
  }
  const regions: RegionResult[] = []
  let canaryPixels = 0
  let totalPixels = 0
  for (let row = 0; row < grid.rows; row++) {
    for (let col = 0; col < grid.cols; col++) {
      const index = row * grid.cols + col
      const count = counts[index] ?? 0
      const total = totals[index] ?? 0
      canaryPixels += count
      totalPixels += total
      regions.push({
        row,
        col,
        canaryPixels: count,
        totalPixels: total,
        status: total > 0 && count / total > REGION_FAIL_FRACTION ? 'FAIL' : 'PASS'
      })
    }
  }
  return { regions, canaryPixels, totalPixels, fraction: totalPixels === 0 ? 0 : canaryPixels / totalPixels }
}

/**
 * PASS needs both: the control saw the overlay (so the test can see it at all)
 * and the protected capture did not. A control that sees nothing is INCONCLUSIVE.
 */
export function judge(protectedRun: Analysis, control: Analysis): { verdict: Verdict; notes: string[] } {
  const notes: string[] = []
  if (control.fraction < CONTROL_DETECT_FRACTION) {
    notes.push(
      `The control capture (protection off) only showed ${(control.fraction * 100).toFixed(1)}% of the overlay, so this test cannot tell whether protection works. Check that the overlay is on the primary display and not covered.`
    )
    return { verdict: 'INCONCLUSIVE', notes }
  }
  const failed = protectedRun.regions.filter((region) => region.status === 'FAIL')
  if (failed.length > 0) {
    notes.push(`${failed.length} of ${protectedRun.regions.length} regions show overlay pixels in a capture with protection on.`)
    return { verdict: 'FAIL', notes }
  }
  notes.push('No overlay pixels in any region with protection on; the control confirmed the test can see the overlay.')
  return { verdict: 'PASS', notes }
}

function setPixel(data: Uint8Array, width: number, x: number, y: number, color: readonly number[]): void {
  const offset = (y * width + x) * 4
  data[offset] = color[0] ?? 0
  data[offset + 1] = color[1] ?? 0
  data[offset + 2] = color[2] ?? 0
  data[offset + 3] = color[3] ?? 255
}

/**
 * Renders the overlay rectangle of a capture as the diff image: the screen
 * dimmed, overlay pixels in solid red, and each region outlined green (PASS) or yellow (FAIL).
 */
export function renderDiff(capture: Bitmap, baseline: Bitmap, rect: Rect, regions: readonly RegionResult[], grid: Grid): Bitmap {
  assertSameSize(capture, baseline)
  const out = new Uint8Array(rect.width * rect.height * 4)
  for (let y = 0; y < rect.height; y++) {
    for (let x = 0; x < rect.width; x++) {
      const source = ((rect.y + y) * capture.width + (rect.x + x)) * 4
      if (isOverlayPixel(capture.data, baseline.data, source)) {
        setPixel(out, rect.width, x, y, MARK_CANARY)
      } else {
        const target = (y * rect.width + x) * 4
        out[target] = (capture.data[source] ?? 0) >> 1
        out[target + 1] = (capture.data[source + 1] ?? 0) >> 1
        out[target + 2] = (capture.data[source + 2] ?? 0) >> 1
        out[target + 3] = 255
      }
    }
  }
  for (const region of regions) {
    const color = region.status === 'FAIL' ? BORDER_FAIL : BORDER_PASS
    const x0 = Math.floor((region.col * rect.width) / grid.cols)
    const x1 = Math.floor(((region.col + 1) * rect.width) / grid.cols) - 1
    const y0 = Math.floor((region.row * rect.height) / grid.rows)
    const y1 = Math.floor(((region.row + 1) * rect.height) / grid.rows) - 1
    for (let x = x0; x <= x1; x++) {
      setPixel(out, rect.width, x, y0, color)
      setPixel(out, rect.width, x, y1, color)
    }
    for (let y = y0; y <= y1; y++) {
      setPixel(out, rect.width, x0, y, color)
      setPixel(out, rect.width, x1, y, color)
    }
  }
  return { data: out, width: rect.width, height: rect.height }
}
