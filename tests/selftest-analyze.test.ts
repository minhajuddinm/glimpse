import { describe, expect, it } from 'vitest'
import {
  CONTROL_DETECT_FRACTION,
  GRID,
  analyzeCapture,
  isCanaryPixel,
  judge,
  rectToPixels,
  renderDiff,
  type Bitmap
} from '../src/main/selftest/analyze'
import type { Rect } from '../src/shared/capture'

const WIDTH = 100
const HEIGHT = 60
const OVERLAY: Rect = { x: 60, y: 0, width: 40, height: 60 }

type Bgr = readonly [number, number, number]
const GRAY: Bgr = [90, 90, 90]
const MAGENTA: Bgr = [255, 0, 255]
const LIME: Bgr = [0, 255, 0]

function bitmap(fill: Bgr): Bitmap {
  const data = new Uint8Array(WIDTH * HEIGHT * 4)
  for (let i = 0; i < WIDTH * HEIGHT; i++) {
    data[i * 4] = fill[0]
    data[i * 4 + 1] = fill[1]
    data[i * 4 + 2] = fill[2]
    data[i * 4 + 3] = 255
  }
  return { data, width: WIDTH, height: HEIGHT }
}

/** Paints the checkerboard of canary colours over the given rectangle. */
function paintCanary(target: Bitmap, rect: Rect): void {
  for (let y = rect.y; y < rect.y + rect.height; y++) {
    for (let x = rect.x; x < rect.x + rect.width; x++) {
      const colour = (x >> 3) % 2 === 0 ? MAGENTA : LIME
      const offset = (y * target.width + x) * 4
      target.data[offset] = colour[0]
      target.data[offset + 1] = colour[1]
      target.data[offset + 2] = colour[2]
    }
  }
}

describe('isCanaryPixel', () => {
  it('matches the two canary colours with a tolerance and nothing else', () => {
    expect(isCanaryPixel(255, 0, 255)).toBe(true)
    expect(isCanaryPixel(230, 20, 240)).toBe(true)
    expect(isCanaryPixel(0, 255, 0)).toBe(true)
    expect(isCanaryPixel(90, 90, 90)).toBe(false)
    expect(isCanaryPixel(255, 255, 255)).toBe(false)
    expect(isCanaryPixel(0, 0, 0)).toBe(false)
  })
})

describe('rectToPixels', () => {
  it('scales DIPs to physical pixels using the capture size', () => {
    const rect = rectToPixels({ x: 860, y: 0, width: 420, height: 672 }, { x: 0, y: 0, width: 1280, height: 720 }, { width: 1920, height: 1080 })
    expect(rect).toEqual({ x: 1290, y: 0, width: 630, height: 1008 })
  })

  it('accounts for a display that does not start at the origin and clamps to the capture', () => {
    const rect = rectToPixels({ x: 1900, y: 10, width: 200, height: 50 }, { x: 1920, y: 0, width: 1920, height: 1080 }, { width: 1920, height: 1080 })
    expect(rect).toEqual({ x: 0, y: 10, width: 180, height: 50 })
  })
})

describe('analyzeCapture and judge', () => {
  const baseline = bitmap(GRAY)

  it('PASSES when protection hides the overlay and the control sees it', () => {
    const protectedCapture = bitmap(GRAY)
    const controlCapture = bitmap(GRAY)
    paintCanary(controlCapture, OVERLAY)

    const protectedRun = analyzeCapture(protectedCapture, baseline, OVERLAY, GRID)
    const controlRun = analyzeCapture(controlCapture, baseline, OVERLAY, GRID)

    expect(protectedRun.canaryPixels).toBe(0)
    expect(controlRun.fraction).toBeGreaterThanOrEqual(CONTROL_DETECT_FRACTION)
    expect(controlRun.regions).toHaveLength(GRID.cols * GRID.rows)
    expect(judge(protectedRun, controlRun).verdict).toBe('PASS')
  })

  it('FAILS when overlay pixels leak into even one region', () => {
    const leaked = bitmap(GRAY)
    paintCanary(leaked, { x: 60, y: 0, width: 20, height: 10 })
    const controlCapture = bitmap(GRAY)
    paintCanary(controlCapture, OVERLAY)

    const protectedRun = analyzeCapture(leaked, baseline, OVERLAY, GRID)
    const verdict = judge(protectedRun, analyzeCapture(controlCapture, baseline, OVERLAY, GRID))

    expect(protectedRun.regions.some((region) => region.status === 'FAIL')).toBe(true)
    expect(verdict.verdict).toBe('FAIL')
  })

  it('is INCONCLUSIVE when the control cannot see the overlay either', () => {
    const run = analyzeCapture(bitmap(GRAY), baseline, OVERLAY, GRID)
    expect(judge(run, run).verdict).toBe('INCONCLUSIVE')
  })

  it('ignores magenta/lime pixels that were already on screen in the baseline', () => {
    const colourfulBaseline = bitmap(GRAY)
    paintCanary(colourfulBaseline, { x: 62, y: 5, width: 30, height: 30 })
    const sameScreen = bitmap(GRAY)
    paintCanary(sameScreen, { x: 62, y: 5, width: 30, height: 30 })

    expect(analyzeCapture(sameScreen, colourfulBaseline, OVERLAY, GRID).canaryPixels).toBe(0)
  })

  it('rejects captures of different sizes', () => {
    const small: Bitmap = { data: new Uint8Array(4), width: 1, height: 1 }
    expect(() => analyzeCapture(small, baseline, OVERLAY, GRID)).toThrow(/size mismatch/)
  })
})

describe('renderDiff', () => {
  it('marks overlay pixels in red and outlines failing regions', () => {
    const baseline = bitmap(GRAY)
    const leaked = bitmap(GRAY)
    paintCanary(leaked, OVERLAY)
    const run = analyzeCapture(leaked, baseline, OVERLAY, GRID)
    const diff = renderDiff(leaked, baseline, OVERLAY, run.regions, GRID)

    expect(diff.width).toBe(OVERLAY.width)
    expect(diff.height).toBe(OVERLAY.height)
    // An interior pixel is solid red (BGRA 0,0,255,255).
    const inside = (5 * diff.width + 4) * 4
    expect([...diff.data.slice(inside, inside + 4)]).toEqual([0, 0, 255, 255])
    // The region border is yellow (0,215,255) because every region failed.
    expect([...diff.data.slice(0, 4)]).toEqual([0, 215, 255, 255])
  })

  it('dims the unchanged screen so the overlay stands out', () => {
    const baseline = bitmap(GRAY)
    const diff = renderDiff(baseline, baseline, OVERLAY, [], GRID)
    expect([...diff.data.slice(0, 4)]).toEqual([45, 45, 45, 255])
  })
})
