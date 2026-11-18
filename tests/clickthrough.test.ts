import { describe, expect, it } from 'vitest'
import { ClickThroughPoller, pointInRect, shouldIgnoreMouse, type Point } from '../src/main/clickthrough'
import type { Rect } from '../src/shared/capture'

const windowBounds: Rect = { x: 860, y: 0, width: 420, height: 672 }
const header: Rect = { x: 0, y: 0, width: 420, height: 56 }

describe('pointInRect', () => {
  it('includes the top-left edge and excludes the bottom-right edge', () => {
    const rect: Rect = { x: 10, y: 10, width: 5, height: 5 }
    expect(pointInRect({ x: 10, y: 10 }, rect)).toBe(true)
    expect(pointInRect({ x: 15, y: 12 }, rect)).toBe(false)
    expect(pointInRect({ x: 12, y: 15 }, rect)).toBe(false)
  })
})

describe('shouldIgnoreMouse', () => {
  const base = { windowBounds, hitRects: [header] }

  it('never ignores the mouse when click-through is off', () => {
    expect(shouldIgnoreMouse({ ...base, clickThrough: false, cursor: { x: 900, y: 300 } })).toBe(false)
  })

  it('ignores the mouse over the panel body when click-through is on', () => {
    expect(shouldIgnoreMouse({ ...base, clickThrough: true, cursor: { x: 900, y: 300 } })).toBe(true)
  })

  it('accepts the mouse over a hit-box (window-relative) when click-through is on', () => {
    expect(shouldIgnoreMouse({ ...base, clickThrough: true, cursor: { x: 900, y: 20 } })).toBe(false)
  })

  it('ignores the mouse when the cursor is outside the window entirely', () => {
    expect(shouldIgnoreMouse({ ...base, clickThrough: true, cursor: { x: 100, y: 20 } })).toBe(true)
  })
})

describe('ClickThroughPoller', () => {
  function setup(initial: { cursor: Point; clickThrough: boolean }) {
    const state = { ...initial }
    const applied: boolean[] = []
    const poller = new ClickThroughPoller({
      getCursor: () => state.cursor,
      getBounds: () => windowBounds,
      getHitRects: () => [header],
      isClickThrough: () => state.clickThrough,
      apply: (ignore) => applied.push(ignore)
    })
    return { state, applied, poller }
  }

  it('restores click-through when the cursor leaves the hit-box, applying only on change', () => {
    const { state, applied, poller } = setup({ cursor: { x: 900, y: 300 }, clickThrough: true })
    poller.tick()
    poller.tick()
    expect(applied).toEqual([true])

    state.cursor = { x: 900, y: 20 }
    poller.tick()
    poller.tick()
    expect(applied).toEqual([true, false])
    expect(poller.ignoring).toBe(false)

    state.cursor = { x: 900, y: 400 }
    poller.tick()
    expect(applied).toEqual([true, false, true])
  })

  it('stops ignoring as soon as click-through is switched off', () => {
    const { state, applied, poller } = setup({ cursor: { x: 900, y: 300 }, clickThrough: true })
    poller.tick()
    state.clickThrough = false
    poller.tick()
    expect(applied).toEqual([true, false])
  })

  it('re-applies after reset()', () => {
    const { applied, poller } = setup({ cursor: { x: 900, y: 300 }, clickThrough: true })
    poller.tick()
    poller.reset()
    poller.tick()
    expect(applied).toEqual([true, true])
  })
})
