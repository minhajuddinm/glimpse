import type { CalendarService } from './calendar/service'
import { inviteText, normalizeCalendarUrl } from './calendar/ics'
import { registerHandler } from './ipc'
import type { SecretStore } from './secrets'
import { isTrustedSender } from './security'

export interface CalendarHandlerContext {
  readonly calendar: CalendarService
  readonly secrets: SecretStore
  readonly now: () => number
  /** Puts a brief for this invite in the overlay. */
  readonly brief: (invite: string) => void
}

/** The secret address goes in, never out: the renderer only learns whether one is saved. */
export function registerCalendarHandlers(ctx: CalendarHandlerContext): void {
  const { calendar, secrets } = ctx
  registerHandler('calendar:status', isTrustedSender, () => calendar.status())
  registerHandler('calendar:set-url', isTrustedSender, async ({ url }) => {
    await secrets.set('calendar', url.trim() === '' ? '' : normalizeCalendarUrl(url))
    await calendar.refresh()
    return calendar.status()
  })
  registerHandler('calendar:refresh', isTrustedSender, async () => {
    await calendar.refresh()
    return calendar.status()
  })
  registerHandler('calendar:brief', isTrustedSender, ({ id }) => {
    const event = calendar.status().events.find((candidate) => candidate.id === id)
    if (event === undefined) throw new Error('That event is no longer in the calendar.')
    ctx.brief(inviteText(event, ctx.now()))
    return null
  })
}
