import type { LiveMode, LiveStatus } from './capture'

export interface LiveView {
  readonly running: boolean
  readonly secondsLeft: number
  readonly mode: LiveMode | null
}

/**
 * What the live-test card should show for a status at a given time.
 *
 * A session also counts as over once its end time has passed. The card used to
 * rely only on the "ended" event from the main process, so a lost event left it
 * stuck on "0s" with every button disabled.
 */
export function liveView(status: LiveStatus, now: number): LiveView {
  if (status.endsAt === null || now >= status.endsAt) return { running: false, secondsLeft: 0, mode: null }
  return {
    running: true,
    secondsLeft: Math.max(0, Math.ceil((status.endsAt - now) / 1000)),
    mode: status.mode ?? 'protected'
  }
}
