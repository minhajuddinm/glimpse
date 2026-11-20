import { useEffect, useState } from 'react'
import {
  ArrowLeft,
  CalendarClock,
  Check,
  ClipboardCopy,
  Download,
  FileText,
  FolderOpen,
  ListChecks,
  Loader2,
  Mic,
  PenLine,
  RefreshCw,
  ScrollText,
  Settings2,
  Square,
  Trash2,
  Users
} from 'lucide-react'
import { displayAccelerator } from '../../../shared/accelerator'
import { formatDuration, type MeetingDetail, type MeetingState, type MeetingStatus, type MeetingSummary } from '../../../shared/meetings'
import type { TranscriptSnapshot } from '../../../shared/transcript'
import { errorMessage, subscribe } from '../ipc'
import { IS_MAC } from '../platform'
import { useSettingsStore } from '../store'
import { Badge, Button, Card, EmptyState, ErrorBanner, Kbd, Loading, Notice, Row, Select, TextInput, Toggle } from '../ui'
import { CalendarCard } from './CalendarCard'
import { MinutesView } from './MinutesView'

const STATUS: Record<MeetingStatus, { label: string; tone: 'good' | 'bad' | 'warn' | 'neutral' | 'accent' }> = {
  recording: { label: 'Recording', tone: 'bad' },
  summarizing: { label: 'Writing minutes…', tone: 'accent' },
  done: { label: 'Minutes ready', tone: 'good' },
  error: { label: 'No minutes', tone: 'warn' },
  interrupted: { label: 'Interrupted', tone: 'warn' }
}

function when(at: number): string {
  return new Date(at).toLocaleString(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
}

function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!active) return
    const timer = setInterval(() => {
      setNow(Date.now())
    }, 1000)
    return () => {
      clearInterval(timer)
    }
  }, [active])
  return now
}

function transcriptText(detail: MeetingDetail): string {
  return detail.transcript.map((line) => `${line.source === 'them' ? 'Them' : 'You'}: ${line.text}`).join('\n')
}

/** Start / stop, with a live view of the meeting being recorded. */
function SessionCard({ state, onError }: { state: MeetingState; onError: (message: string) => void }) {
  const [title, setTitle] = useState('')
  const [busy, setBusy] = useState(false)
  const [transcript, setTranscript] = useState<TranscriptSnapshot | null>(null)
  const hotkey = useSettingsStore((store) => store.settings?.hotkeys.toggleMeeting)
  const active = state.active
  const now = useNow(active !== null)

  useEffect(() => {
    if (active === null) return
    void window.glimpse.invoke('transcript:get', null).then(setTranscript)
    return subscribe('transcript:update', setTranscript)
  }, [active])

  const run = async (action: () => Promise<unknown>): Promise<void> => {
    setBusy(true)
    try {
      await action()
    } catch (caught) {
      onError(errorMessage(caught))
    } finally {
      setBusy(false)
    }
  }

  if (active === null) {
    return (
      <Card
        title="Start a meeting"
        icon={Mic}
        description="Glimpse saves the full transcript while the meeting runs, then writes the minutes when you stop: summary, decisions, action items and open questions."
        tone="accent"
      >
        <div className="flex items-center gap-2">
          <TextInput
            value={title}
            onChange={setTitle}
            placeholder="Title (optional), e.g. Acme pricing call"
            maxLength={200}
            onEnter={() => void run(() => window.glimpse.invoke('meetings:start', { title }).then(() => { setTitle('') }))}
          />
          <Button
            icon={Mic}
            disabled={busy}
            onClick={() => void run(() => window.glimpse.invoke('meetings:start', { title }).then(() => { setTitle('') }))}
          >
            Start meeting
          </Button>
        </div>
        {hotkey !== undefined && (
          <p className="mt-2.5 text-xs text-text-faint">
            Or press <Kbd>{displayAccelerator(hotkey, IS_MAC)}</Kbd> from any app to start and stop.
          </p>
        )}
      </Card>
    )
  }

  // Only what was said since the meeting started (the live transcript also holds earlier talk).
  const recent = (transcript?.segments ?? []).filter((segment) => segment.at >= active.startedAt).slice(-3)
  return (
    <Card
      title={active.title}
      icon={Mic}
      description={`Started ${when(active.startedAt)}`}
      tone="accent"
      actions={
        <Badge tone="bad" dot>
          REC {formatDuration(now - active.startedAt)}
        </Badge>
      }
    >
      <div className="mb-4 grid grid-cols-2 gap-2.5">
        <div className="rounded-xl border border-hairline bg-white/[0.02] px-4 py-3">
          <div className="text-[20px] font-semibold leading-none text-white">{active.lines}</div>
          <div className="mt-1.5 text-[11px] text-text-faint">lines saved</div>
        </div>
        <div className="rounded-xl border border-hairline bg-white/[0.02] px-4 py-3">
          <div className="text-[20px] font-semibold leading-none text-white">{active.words}</div>
          <div className="mt-1.5 text-[11px] text-text-faint">words</div>
        </div>
      </div>
      {recent.length > 0 && (
        <div className="mb-4 space-y-1 rounded-xl bg-ink/50 px-3.5 py-2.5 text-[12.5px] leading-relaxed">
          {recent.map((segment) => (
            <div key={segment.id} className="truncate">
              <span className={segment.source === 'them' ? 'text-indigo-300' : 'text-violet-soft'}>{segment.source === 'them' ? 'Them' : 'You'}:</span>{' '}
              <span className="text-text-muted">{segment.text}</span>
            </div>
          ))}
        </div>
      )}
      <Button tone="danger" icon={Square} disabled={busy} onClick={() => void run(() => window.glimpse.invoke('meetings:stop', null))}>
        Stop and write minutes
      </Button>
    </Card>
  )
}

function MeetingRow({ meeting, onOpen }: { meeting: MeetingSummary; onOpen: () => void }) {
  const status = STATUS[meeting.status]
  const length = meeting.endedAt === null ? null : formatDuration(meeting.endedAt - meeting.startedAt)
  return (
    <button
      type="button"
      onClick={onOpen}
      className="group flex w-full cursor-pointer items-start gap-3 rounded-xl border border-hairline bg-white/[0.02] p-3.5 text-left transition duration-200 hover:border-white/15 hover:bg-white/[0.045] active:scale-[0.99]"
    >
      <div className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-violet/12 text-violet-soft ring-1 ring-violet/20">
        {meeting.status === 'summarizing' ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <FileText className="h-4 w-4" aria-hidden />}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-[13.5px] font-semibold text-white">{meeting.title}</span>
          <span className="shrink-0">
            <Badge tone={status.tone}>{status.label}</Badge>
          </span>
        </div>
        <div className="mt-0.5 text-[11.5px] text-text-faint">
          {when(meeting.startedAt)}
          {length !== null ? ` · ${length}` : ''} · {meeting.words} words
        </div>
        {meeting.preview !== '' && <div className="mt-1.5 line-clamp-2 text-[12.5px] leading-snug text-text-muted">{meeting.preview}</div>}
      </div>
    </button>
  )
}

function DetailView({ id, onBack, onError }: { id: number; onBack: () => void; onError: (message: string) => void }) {
  const [detail, setDetail] = useState<MeetingDetail | null | undefined>(undefined)
  const [editing, setEditing] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [copied, setCopied] = useState<'minutes' | 'transcript' | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [showTranscript, setShowTranscript] = useState(false)

  useEffect(() => {
    const load = (): void => {
      void window.glimpse.invoke('meetings:get', { id }).then(setDetail)
    }
    load()
    // Reload when the list changes (minutes written, renamed).
    return subscribe('meetings:list', load)
  }, [id])

  if (detail === undefined) return <Loading label="Loading meeting" />
  if (detail === null) {
    return (
      <EmptyState icon={FileText} title="This meeting was deleted.">
        <Button tone="ghost" size="sm" icon={ArrowLeft} onClick={onBack}>
          Back to meetings
        </Button>
      </EmptyState>
    )
  }

  const act = async (action: () => Promise<unknown>): Promise<void> => {
    try {
      await action()
    } catch (caught) {
      onError(errorMessage(caught))
    }
  }
  const copy = (what: 'minutes' | 'transcript', text: string): void => {
    void navigator.clipboard.writeText(text).then(() => {
      setCopied(what)
      setTimeout(() => {
        setCopied((current) => (current === what ? null : current))
      }, 2000)
    })
  }
  const status = STATUS[detail.status]
  const length = detail.endedAt === null ? null : formatDuration(detail.endedAt - detail.startedAt)
  const canWrite = detail.status !== 'recording' && detail.status !== 'summarizing'

  return (
    <>
      <div>
        <Button tone="subtle" size="sm" icon={ArrowLeft} onClick={onBack}>
          All meetings
        </Button>
      </div>

      <Card>
        {editing === null ? (
          <div className="flex items-start gap-3">
            <div className="min-w-0 flex-1">
              <h2 className="text-[18px] font-semibold tracking-tight text-white">{detail.title}</h2>
              <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-text-faint">
                <Badge tone={status.tone}>{status.label}</Badge>
                <span>{when(detail.startedAt)}</span>
                {length !== null && <span>· {length}</span>}
                <span>· {detail.words} words</span>
                {detail.model !== null && <span>· minutes by {detail.model}</span>}
              </div>
            </div>
            <Button tone="subtle" size="sm" icon={PenLine} title="Rename" onClick={() => { setEditing(detail.title) }} />
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <TextInput
              value={editing}
              onChange={setEditing}
              maxLength={200}
              aria-label="Meeting title"
              onEnter={() => void act(() => window.glimpse.invoke('meetings:rename', { id, title: editing }).then(() => { setEditing(null) }))}
            />
            <Button size="sm" icon={Check} disabled={editing.trim() === ''} onClick={() => void act(() => window.glimpse.invoke('meetings:rename', { id, title: editing }).then(() => { setEditing(null) }))}>
              Save
            </Button>
            <Button tone="subtle" size="sm" onClick={() => { setEditing(null) }}>
              Cancel
            </Button>
          </div>
        )}

        <div className="mt-4 flex flex-wrap gap-2">
          {detail.minutes !== null && (
            <Button tone="ghost" size="sm" icon={copied === 'minutes' ? Check : ClipboardCopy} onClick={() => { copy('minutes', detail.minutes ?? '') }}>
              {copied === 'minutes' ? 'Copied' : 'Copy minutes'}
            </Button>
          )}
          <Button tone="ghost" size="sm" icon={Download} onClick={() => void act(() => window.glimpse.invoke('meetings:export', { id }).then((path) => { if (path !== null) setMessage(`Saved to ${path}`) }))}>
            Export…
          </Button>
          {detail.file !== null && (
            <Button tone="ghost" size="sm" icon={FolderOpen} onClick={() => void act(() => window.glimpse.invoke('meetings:open-file', { id }))}>
              Show in notes folder
            </Button>
          )}
          {canWrite && (
            <Button tone="ghost" size="sm" icon={RefreshCw} onClick={() => void act(() => window.glimpse.invoke('meetings:summarize', { id }))}>
              {detail.minutes === null ? 'Write minutes' : 'Rewrite minutes'}
            </Button>
          )}
          {detail.status !== 'recording' &&
            (confirmDelete ? (
              <>
                <Button tone="danger" size="sm" icon={Trash2} onClick={() => void act(() => window.glimpse.invoke('meetings:delete', { id }).then(onBack))}>
                  Delete for good
                </Button>
                <Button tone="subtle" size="sm" onClick={() => { setConfirmDelete(false) }}>
                  Keep
                </Button>
              </>
            ) : (
              <Button tone="subtle" size="sm" icon={Trash2} onClick={() => { setConfirmDelete(true) }}>
                Delete
              </Button>
            ))}
        </div>
        {message !== null && <p className="mt-2.5 text-xs text-emerald-300">{message}</p>}
      </Card>

      <Card title="Minutes" icon={ListChecks}>
        {detail.status === 'summarizing' ? (
          <div className="space-y-2.5" aria-busy="true" aria-label="Writing minutes">
            <div className="skeleton h-4 w-2/3 rounded" />
            <div className="skeleton h-4 w-full rounded" />
            <div className="skeleton h-4 w-5/6 rounded" />
            <p className="pt-1 text-xs text-text-faint">Writing the minutes — usually 10–30 seconds.</p>
          </div>
        ) : detail.minutes !== null ? (
          <>
            {detail.error !== null && (
              <div className="mb-3">
                <Notice tone="warn">{`${detail.error} The earlier minutes are kept below.`}</Notice>
              </div>
            )}
            <MinutesView markdown={detail.minutes} />
          </>
        ) : (
          <Notice tone="warn">{detail.error ?? 'No minutes yet. Use “Write minutes” above.'}</Notice>
        )}
      </Card>

      <Card
        title="Transcript"
        icon={ScrollText}
        description={`${String(detail.transcript.length)} lines. “You” is your microphone, “Them” is everyone else.`}
        actions={
          <>
            {detail.transcript.length > 0 && (
              <Button tone="subtle" size="sm" icon={copied === 'transcript' ? Check : ClipboardCopy} onClick={() => { copy('transcript', transcriptText(detail)) }}>
                {copied === 'transcript' ? 'Copied' : 'Copy'}
              </Button>
            )}
            <Button tone="ghost" size="sm" onClick={() => { setShowTranscript((shown) => !shown) }}>
              {showTranscript ? 'Hide' : 'Show'}
            </Button>
          </>
        }
      >
        {showTranscript ? (
          <div className="max-h-[420px] space-y-1.5 overflow-y-auto pr-1 text-[12.5px] leading-relaxed">
            {detail.transcript.map((line, index) => (
              <div key={index} className="flex gap-2.5">
                <span className="w-12 shrink-0 font-mono text-[11px] text-text-faint">{formatDuration(line.at - detail.startedAt)}</span>
                <span className={`w-10 shrink-0 font-medium ${line.source === 'them' ? 'text-indigo-300' : 'text-violet-soft'}`}>{line.source === 'them' ? 'Them' : 'You'}</span>
                <span className="text-text-muted">{line.text}</span>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-xs text-text-faint">Kept on this computer only. The minutes file in your notes folder does not include it.</p>
        )}
      </Card>
    </>
  )
}

export function MeetingsPage() {
  const { settings, update } = useSettingsStore()
  const [state, setState] = useState<MeetingState | null>(null)
  const [list, setList] = useState<MeetingSummary[] | null>(null)
  const [open, setOpen] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    void window.glimpse.invoke('meetings:state', null).then(setState)
    void window.glimpse.invoke('meetings:list', null).then(setList)
    const offs = [subscribe('meetings:state', setState), subscribe('meetings:list', setList)]
    return () => {
      for (const off of offs) off()
    }
  }, [])

  if (settings === null || state === null || list === null) return <Loading label="Loading meetings" />

  const errorBanner = error !== null && <ErrorBanner message={error} />

  if (open !== null) {
    return (
      <>
        {errorBanner}
        <DetailView id={open} onBack={() => { setOpen(null) }} onError={setError} />
      </>
    )
  }

  const past = list.filter((meeting) => meeting.id !== state.active?.id)
  return (
    <>
      {errorBanner}
      <SessionCard state={state} onError={setError} />
      <CalendarCard meeting={state} />

      <Card title="Past meetings" icon={CalendarClock} description="Click one to read its minutes, copy them, export or delete it.">
        {past.length === 0 ? (
          <EmptyState icon={Users} title="No meetings yet">
            Start one above before your next call. You can also leave Glimpse listening and start a meeting halfway through: minutes cover only what was said after you started.
          </EmptyState>
        ) : (
          <div className="space-y-2">
            {past.map((meeting) => (
              <MeetingRow key={meeting.id} meeting={meeting} onOpen={() => { setError(null); setOpen(meeting.id) }} />
            ))}
          </div>
        )}
      </Card>

      <Card title="Meeting settings" icon={Settings2}>
        <Row
          label="When Glimpse listens"
          hint={
            settings.listenMode === 'meetings'
              ? 'The microphone and system audio are off until you start a meeting, and turn off again when it ends.'
              : 'Always listening, so live answers work without starting a meeting.'
          }
        >
          <Select
            value={settings.listenMode}
            options={[
              { value: 'always', label: 'Always' },
              { value: 'meetings', label: 'Only during meetings' }
            ]}
            onChange={(value) => void update({ listenMode: value })}
          />
        </Row>
        <Row label="Save minutes to the notes folder" hint="As Markdown in Notes → Meetings, so later answers can draw on past meetings. Transcripts stay in Glimpse.">
          <Toggle checked={settings.saveMinutesToNotes} onChange={(checked) => void update({ saveMinutesToNotes: checked })} />
        </Row>
        <div className="pt-3.5">
          <Notice tone="info">
            Recording laws differ by place: many require everyone on the call to agree to being transcribed. Tell the others when you start a meeting.
          </Notice>
        </div>
      </Card>
    </>
  )
}
