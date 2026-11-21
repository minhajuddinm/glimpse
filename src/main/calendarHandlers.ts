import type { CalendarService } from './calendar/service'
import { checkGoogleClient, parseSavedClient, revokeGoogleToken, signInWithGoogle, type GoogleCalendar } from './calendar/google'
import { inviteText, normalizeCalendarUrl } from './calendar/ics'
import { registerHandler } from './ipc'
import type { SecretStore } from './secrets'
import { isTrustedSender } from './security'

export interface CalendarHandlerContext {
  readonly calendar: CalendarService
  readonly google: GoogleCalendar
  readonly secrets: SecretStore
  readonly now: () => number
  /** Opens Google's sign-in page in the default browser. */
  readonly openBrowser: (url: string) => Promise<void>
  /** Puts a brief for this invite in the overlay. */
  readonly brief: (invite: string) => void
}

/**
 * Secrets go in, never out: the renderer only learns whether a calendar is connected, and
 * the Google client ID (which is not secret). One calendar at a time: connecting one way
 * disconnects the other.
 */
export function registerCalendarHandlers(ctx: CalendarHandlerContext): void {
  const { calendar, google, secrets } = ctx
  let signingIn: AbortController | null = null

  const forgetGoogle = async (): Promise<void> => {
    const token = secrets.get('google-token')
    await secrets.set('google-token', '')
    google.reset()
    if (token !== null) void revokeGoogleToken(token)
  }

  registerHandler('calendar:status', isTrustedSender, () => calendar.status())
  registerHandler('calendar:set-url', isTrustedSender, async ({ url }) => {
    const address = url.trim() === '' ? '' : normalizeCalendarUrl(url)
    await secrets.set('calendar', address)
    if (address !== '') await forgetGoogle()
    await calendar.refresh()
    return calendar.status()
  })
  registerHandler('calendar:google-connect', isTrustedSender, async ({ clientId, clientSecret }) => {
    const typed = clientId.trim() !== '' || clientSecret.trim() !== ''
    const client = typed ? checkGoogleClient(clientId, clientSecret) : parseSavedClient(secrets.get('google-client'))
    if (client === null) throw new Error('Paste the client ID and client secret from Google Cloud first.')
    signingIn?.abort()
    const controller = new AbortController()
    signingIn = controller
    try {
      const refreshToken = await signInWithGoogle({ client, openBrowser: ctx.openBrowser, signal: controller.signal })
      const previous = secrets.get('google-token')
      // Saved only once Google accepted it, so a mistyped client is never kept.
      await secrets.set('google-client', JSON.stringify(client))
      await secrets.set('google-token', refreshToken)
      await secrets.set('calendar', '')
      google.reset()
      if (previous !== null && previous !== refreshToken) void revokeGoogleToken(previous)
    } finally {
      if (signingIn === controller) signingIn = null
    }
    await calendar.refresh()
    return calendar.status()
  })
  registerHandler('calendar:google-cancel', isTrustedSender, () => {
    signingIn?.abort()
    return null
  })
  registerHandler('calendar:google-disconnect', isTrustedSender, async () => {
    await forgetGoogle()
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
