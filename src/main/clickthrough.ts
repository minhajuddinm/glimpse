import type { Rect } from '../shared/capture'

export interface Point {
  readonly x: number
  readonly y: number
}

export function pointInRect(point: Point, rect: Rect): boolean {
  return point.x >= rect.x && point.x < rect.x + rect.width && point.y >= rect.y && point.y < rect.y + rect.height
}

/**
 * Decides whether the overlay should let mouse events fall through to the app
 * behind it. In click-through mode the whole window is transparent to the mouse,
 * except while the cursor is over one of the interactive hit-boxes (the header
 * controls). Hit-boxes are relative to the window; the cursor is in screen space.
 */
export function shouldIgnoreMouse(input: {
  readonly clickThrough: boolean
  readonly cursor: Point
  readonly windowBounds: Rect
  readonly hitRects: readonly Rect[]
}): boolean {
  if (!input.clickThrough) return false
  const local: Point = {
    x: input.cursor.x - input.windowBounds.x,
    y: input.cursor.y - input.windowBounds.y
  }
  return !input.hitRects.some((rect) => pointInRect(local, rect))
}

export interface PollerDeps {
  readonly getCursor: () => Point
  readonly getBounds: () => Rect | null
  readonly getHitRects: () => readonly Rect[]
  readonly isClickThrough: () => boolean
  /** Applies the decision to the window. Only called when the decision changes. */
  readonly apply: (ignore: boolean) => void
  readonly intervalMs?: number
}

/** Polls the cursor (60ms by default) and flips mouse pass-through only on change. */
export class ClickThroughPoller {
  private timer: ReturnType<typeof setInterval> | null = null
  private current: boolean | null = null

  constructor(private readonly deps: PollerDeps) {}

  get ignoring(): boolean {
    return this.current ?? false
  }

  start(): void {
    if (this.timer !== null) return
    this.timer = setInterval(() => {
      this.tick()
    }, this.deps.intervalMs ?? 60)
  }

  stop(): void {
    if (this.timer !== null) clearInterval(this.timer)
    this.timer = null
  }

  /** Forget the last applied decision so the next tick re-applies it. */
  reset(): void {
    this.current = null
  }

  tick(): void {
    const bounds = this.deps.getBounds()
    if (bounds === null) return
    const ignore = shouldIgnoreMouse({
      clickThrough: this.deps.isClickThrough(),
      cursor: this.deps.getCursor(),
      windowBounds: bounds,
      hitRects: this.deps.getHitRects()
    })
    if (ignore === this.current) return
    this.current = ignore
    this.deps.apply(ignore)
  }
}
