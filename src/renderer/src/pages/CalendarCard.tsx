import { useEffect, useState } from 'react'
import { CalendarDays, CalendarX2, Link2, Mic, RefreshCw, Sparkles, Unplug, Users } from 'lucide-react'
import { isRealMeeting, type CalendarEvent, type CalendarStatus } from '../../../shared/calendar'
import type { MeetingState } from '../../../shared/meetings'
import { errorMessage, subscribe } from '../ipc'
import { useSettingsStore } from '../store'
import { Badge, Button, Card, EmptyState, ErrorBanner, Row, TextInput, Toggle } from '../ui'

const time = (at: number): string => new Date(at).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })

function dayLabel(at: number, now: number): string {
  const date = new Date(at)
  const today = new Date(now)
  const tomorrow = new Date(now + 24 * 3600_000)
  if (date.toDateString() === today.toDateString()) return 'Today'
  if (date.toDateString() === tomorrow.toDateString()) return 'Tomorrow'
  return date.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })
}

function EventRow({ event, now, canStart, onError }: { event: CalendarEvent; now: number; canStart: boolean; onError: (message: string) => void }) {
  const live = event.start <= now && now < event.end
  const soon = !live && event.start - now <= 15 * 60_000
  const people = event.attendees.length
  const act = (action: () => Promise<unknown>): void => {
    action().catch((caught: unknown) => {
      onError(errorMessage(caught))
    })
  }
  return (
    <div className={`flex items-center gap-3 rounded-xl border px-3.5 py-2.5 ${live ? 'border-violet/35 bg-violet/[0.08]' : 'border-hairline bg-white/[0.02]'}`}>
      <div className="w-[74px] shrink-0 text-[11.5px] leading-tight text-text-faint">
        {event.allDay ? (
          'All day'
        ) : (
          <>
            <div className="font-medium text-text">{time(event.start)}</div>
            <div>{dayLabel(event.start, now)}</div>
          </>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-[13px] font-semibold text-white">{event.title}</span>
          {live && <Badge tone="accent" dot>Now</Badge>}
          {soon && <Badge tone="warn">Soon</Badge>}
        </div>
        <div className="mt-0.5 flex items-center gap-3 text-[11.5px] text-text-faint">
          {people > 0 && (
            <span className="inline-flex items-center gap-1">
              <Users className="h-3 w-3" aria-hidden />
              {people} {people === 1 ? 'person' : 'people'}
            </span>
          )}
          {event.link !== null && (
            <span className="inline-flex items-center gap-1">
              <Link2 className="h-3 w-3" aria-hidden />
              {new URL(event.link).hostname.replace(/^www\./, '')}
            </span>
          )}
          {!event.allDay && <span>until {time(event.end)}</span>}
        </div>
      </div>
      {isRealMeeting(event) && (
        <div className="flex shrink-0 gap-1.5">
          <Button tone="subtle" size="sm" icon={Sparkles} title="Brief me on this meeting (in the overlay)" onClick={() => { act(() => window.glimpse.invoke('calendar:brief', { id: event.id })) }}>
            Brief
          </Button>
          {canStart && (live || soon) && (
            <Button tone="ghost" size="sm" icon={Mic} onClick={() => { act(() => window.glimpse.invoke('meetings:start', { title: event.title })) }}>
              Record
            </Button>
          )}
        </div>
      )}
    </div>
  )
}

/** Connect a calendar by its secret iCal address; shows the next 24 hours. */
export function CalendarCard({ meeting }: { meeting: MeetingState }) {
  const { settings, update } = useSettingsStore()
  const [status, setStatus] = useState<CalendarStatus | null>(null)
  const [url, setUrl] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    void window.glimpse.invoke('calendar:status', null).then(setStatus)
    const off = subscribe('calendar:status', setStatus)
    const timer = setInterval(() => {
      setNow(Date.now())
    }, 30_000)
    return () => {
      off()
      clearInterval(timer)
    }
  }, [])

  if (status === null || settings === null) return null

  const save = async (value: string): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      setStatus(await window.glimpse.invoke('calendar:set-url', { url: value }))
      setUrl('')
    } catch (caught) {
      setError(errorMessage(caught))
    } finally {
      setBusy(false)
    }
  }

  const badge =
    status.state === 'ok' ? <Badge tone="good" dot>Connected</Badge> : status.state === 'syncing' ? <Badge tone="accent">Syncing…</Badge> : status.state === 'error' ? <Badge tone="bad">Error</Badge> : <Badge tone="neutral">Off</Badge>

  return (
    <Card
      title="Calendar"
      icon={CalendarDays}
      description="Read-only, from your calendar’s private iCal address: no sign-in, nothing is changed in your calendar."
      actions={badge}
    >
      {error !== null && (
        <div className="mb-3">
          <ErrorBanner message={error} />
        </div>
      )}

      {!status.connected ? (
        <div className="space-y-3">
          <ol className="list-decimal space-y-1 pl-5 text-[12.5px] leading-relaxed text-text-muted">
            <li>
              <span className="text-text">Google Calendar</span> on the web → Settings → click your calendar under “Settings for my calendars” → Integrate calendar →
              copy <span className="text-text">“Secret address in iCal format”</span>.
            </li>
            <li>
              <span className="text-text">Outlook</span>: Settings → Calendar → Shared calendars → Publish a calendar → copy the ICS link.
            </li>
            <li>Paste it below. Treat it like a password: anyone with it can read your calendar.</li>
          </ol>
          <div className="flex items-center gap-2">
            <TextInput type="password" value={url} onChange={setUrl} placeholder="https://calendar.google.com/calendar/ical/…/private-…/basic.ics" onEnter={() => void save(url)} aria-label="Secret calendar address" />
            <Button icon={CalendarDays} disabled={busy || url.trim() === ''} onClick={() => void save(url)}>
              Connect
            </Button>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="flex items-center gap-2 text-xs text-text-faint">
            <span className={`min-w-0 flex-1 ${status.state === 'error' ? 'text-amber-300' : ''}`}>
              {status.lastSyncAt !== null ? status.message.replace(/\.$/, '') : status.message}
              {status.lastSyncAt !== null && ` · synced ${time(status.lastSyncAt)}`}
            </span>
            <Button tone="subtle" size="sm" icon={RefreshCw} disabled={busy || status.state === 'syncing'} onClick={() => void window.glimpse.invoke('calendar:refresh', null).then(setStatus)}>
              Refresh
            </Button>
            <Button tone="subtle" size="sm" icon={Unplug} disabled={busy} onClick={() => void save('')}>
              Disconnect
            </Button>
          </div>
          {status.events.length === 0 ? (
            // Before a first good sync (an error, or still syncing) there is nothing to say yet.
            status.state === 'ok' && <EmptyState icon={CalendarX2} title="Nothing in the next 24 hours" />
          ) : (
            <div className="space-y-1.5">
              {status.events.map((event) => (
                <EventRow key={event.id} event={event} now={now} canStart={meeting.active === null} onError={setError} />
              ))}
            </div>
          )}
        </div>
      )}

      <div className="mt-4 border-t border-hairline pt-1">
        <Row label="Brief me before meetings" hint="5 minutes before a meeting with other people, the overlay shows who you are meeting and what to prepare, from the invite and your notes.">
          <Toggle checked={settings.calendarBrief} onChange={(checked) => void update({ calendarBrief: checked })} />
        </Row>
        <Row label="Record calendar meetings automatically" hint="Starts a meeting when one with other people or a call link begins, and stops it 10 minutes after it ends. A notification tells you each time.">
          <Toggle checked={settings.calendarAutoStart} onChange={(checked) => void update({ calendarAutoStart: checked })} />
        </Row>
      </div>
    </Card>
  )
}
