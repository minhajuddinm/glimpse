import { useEffect, useState } from 'react'
import { AudioLines, Eye, EyeOff, Keyboard, MessageSquareText, NotebookPen, ScanEye, Settings2, Smartphone, type LucideIcon } from 'lucide-react'
import { displayAccelerator } from '../../shared/accelerator'
import type { OverlayState } from '../../shared/capture'
import type { AudioStatus } from '../../shared/transcript'
import { subscribe } from './ipc'
import { AnswersPage } from './pages/AnswersPage'
import { AudioPage } from './pages/AudioPage'
import { CapturePage } from './pages/CapturePage'
import { CompanionPage } from './pages/CompanionPage'
import { GeneralPage } from './pages/GeneralPage'
import { HotkeysPage } from './pages/HotkeysPage'
import { NotesPage } from './pages/NotesPage'
import { IS_MAC } from './platform'
import { useSettingsStore } from './store'
import { ErrorBanner, PageHeader, StatusDot } from './ui'

interface Tab {
  readonly id: string
  readonly label: string
  readonly icon: LucideIcon
  readonly title: string
  readonly description: string
}

const TABS = [
  { id: 'general', label: 'General', icon: Settings2, title: 'General', description: 'Answer style and how the overlay looks and behaves.' },
  { id: 'answers', label: 'Answers', icon: MessageSquareText, title: 'Answers', description: 'Your AI provider, when Glimpse answers, and what it knows about you.' },
  { id: 'notes', label: 'Notes', icon: NotebookPen, title: 'Notes', description: 'Prepared answers and background Glimpse searches before every answer.' },
  { id: 'audio', label: 'Audio', icon: AudioLines, title: 'Audio', description: 'Your microphone, the other side of the call, and live transcription.' },
  { id: 'companion', label: 'Companion', icon: Smartphone, title: 'Companion', description: 'Follow the transcript and answers on your phone or a second screen.' },
  { id: 'capture', label: 'Capture test', icon: ScanEye, title: 'Capture test', description: 'Prove the overlay stays invisible to screen shares and recorders.' },
  { id: 'hotkeys', label: 'Hotkeys', icon: Keyboard, title: 'Hotkeys', description: 'Global shortcuts that work from any app, even while you share your screen.' }
] as const satisfies readonly Tab[]
type TabId = (typeof TABS)[number]['id']

/** Shows or hides the overlay from the app (it starts hidden unless chosen otherwise). */
function OverlayButton() {
  const [state, setState] = useState<OverlayState | null>(null)
  const hotkey = useSettingsStore((store) => store.settings?.hotkeys.toggleOverlay)
  useEffect(() => {
    void window.glimpse.invoke('overlay:state', null).then(setState)
    return subscribe('overlay:state', setState)
  }, [])
  if (state === null) return null
  const visible = state.visible
  return (
    <button
      type="button"
      aria-pressed={visible}
      disabled={state.panic}
      onClick={() => void window.glimpse.invoke('overlay:set-visible', { visible: !visible }).then(setState)}
      className={`group flex w-full cursor-pointer items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition duration-200 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 ${
        visible ? 'border-violet/40 bg-violet/[0.12] shadow-[0_0_24px_-10px_rgb(139_92_246/0.9)]' : 'border-hairline bg-white/[0.03] hover:bg-white/[0.06]'
      }`}
    >
      <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg ${visible ? 'brand-gradient text-white' : 'bg-white/[0.06] text-text-muted'}`}>
        {visible ? <Eye className="h-4 w-4" aria-hidden /> : <EyeOff className="h-4 w-4" aria-hidden />}
      </span>
      <span className="min-w-0">
        <span className="block text-[12.5px] font-semibold text-white">{state.panic ? 'Panic hide is on' : visible ? 'Overlay on' : 'Overlay off'}</span>
        <span className="block truncate text-[11px] text-text-faint">{visible ? 'Click to hide' : 'Click to show'}{hotkey !== undefined ? ` · ${displayAccelerator(hotkey, IS_MAC)}` : ''}</span>
      </span>
    </button>
  )
}

function ListeningStatus() {
  const [status, setStatus] = useState<AudioStatus | null>(null)
  useEffect(() => {
    void window.glimpse.invoke('audio:status', null).then(setStatus)
    return subscribe('audio:status', setStatus)
  }, [])
  if (status === null) return null
  const live = status.them.state === 'live' || status.you.state === 'live'
  const ready = status.asr.state === 'ready'
  const tone = live && ready ? 'good' : status.asr.state === 'error' || status.asr.state === 'missing-model' ? 'bad' : 'warn'
  const label = live && ready ? 'Listening' : ready ? 'Paused' : status.asr.state === 'loading' ? 'Loading speech…' : 'Speech off'
  return (
    <div className="surface rounded-xl px-3 py-2.5">
      <div className="flex items-center gap-2 text-[12.5px] font-medium text-white">
        <StatusDot tone={tone} label={label} />
        {label}
      </div>
      <div className="mt-1 flex gap-3 text-[11px] text-text-faint">
        <span>Them · {status.them.state}</span>
        <span>You · {status.you.state}</span>
      </div>
    </div>
  )
}

export function App() {
  const info = useSettingsStore((state) => state.info)
  const error = useSettingsStore((state) => state.error)
  const init = useSettingsStore((state) => state.init)
  const [tab, setTab] = useState<TabId>('general')
  const current = TABS.find((candidate) => candidate.id === tab) ?? TABS[0]

  useEffect(() => init(), [init])

  return (
    <div className="app-backdrop flex h-full">
      <aside className="flex w-[232px] shrink-0 flex-col border-r border-hairline bg-ink/40 px-3 py-5 backdrop-blur-xl">
        <div className="mb-6 flex items-center gap-2.5 px-2">
          <img src="./logo.png" alt="" className="h-8 w-8 rounded-lg shadow-[0_0_18px_-4px_rgb(139_92_246/0.8)]" />
          <div>
            <div className="text-gradient font-[family-name:var(--font-display)] text-[17px] font-semibold leading-tight tracking-tight">Glimpse</div>
            <div className="text-[10.5px] text-text-faint">Invisible call copilot</div>
          </div>
        </div>

        <nav className="flex flex-1 flex-col gap-0.5" aria-label="Settings sections">
          {TABS.map(({ id, label, icon: Icon }) => {
            const active = tab === id
            return (
              <button
                key={id}
                type="button"
                aria-current={active ? 'page' : undefined}
                onClick={() => {
                  setTab(id)
                }}
                className={`group relative flex h-9 cursor-pointer items-center gap-2.5 rounded-lg px-2.5 text-[13px] font-medium transition duration-200 ${
                  active ? 'bg-white/[0.07] text-white' : 'text-text-muted hover:bg-white/[0.04] hover:text-white'
                }`}
              >
                {active && <span className="brand-gradient absolute left-0 top-1/2 h-4 w-[3px] -translate-y-1/2 rounded-r-full" />}
                <Icon className={`h-4 w-4 transition ${active ? 'text-violet-soft' : 'text-text-faint group-hover:text-text-muted'}`} aria-hidden />
                {label}
              </button>
            )
          })}
        </nav>

        <div className="space-y-3">
          <OverlayButton />
          <ListeningStatus />
          {info !== null && (
            <div className="px-2 text-[10.5px] leading-relaxed text-text-faint">
              v{info.version} · Electron {info.electron}
              {info.windowsBuild !== null && <div>Windows build {info.windowsBuild}</div>}
              {info.platform === 'darwin' && <div>macOS</div>}
            </div>
          )}
        </div>
      </aside>

      <main className="min-w-0 flex-1 overflow-y-auto">
        <div key={current.id} className="mx-auto max-w-[760px] px-8 py-8">
          <PageHeader icon={current.icon} title={current.title} description={current.description} />
          {error !== null && (
            <div className="mb-5">
              <ErrorBanner message={error} />
            </div>
          )}
          <div className="space-y-5">
            {tab === 'general' && <GeneralPage />}
            {tab === 'answers' && <AnswersPage />}
            {tab === 'notes' && <NotesPage />}
            {tab === 'audio' && <AudioPage />}
            {tab === 'companion' && <CompanionPage />}
            {tab === 'capture' && <CapturePage />}
            {tab === 'hotkeys' && <HotkeysPage />}
          </div>
        </div>
      </main>
    </div>
  )
}
