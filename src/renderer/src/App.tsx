import { useEffect, useState } from 'react'
import { AnswersPage } from './pages/AnswersPage'
import { AudioPage } from './pages/AudioPage'
import { NotesPage } from './pages/NotesPage'
import { CapturePage } from './pages/CapturePage'
import { CompanionPage } from './pages/CompanionPage'
import { GeneralPage } from './pages/GeneralPage'
import { HotkeysPage } from './pages/HotkeysPage'
import { useSettingsStore } from './store'
import { ErrorBanner } from './ui'

const TABS = [
  { id: 'general', label: 'General' },
  { id: 'answers', label: 'Answers' },
  { id: 'notes', label: 'Notes' },
  { id: 'audio', label: 'Audio' },
  { id: 'companion', label: 'Companion' },
  { id: 'capture', label: 'Capture test' },
  { id: 'hotkeys', label: 'Hotkeys' }
] as const
type TabId = (typeof TABS)[number]['id']

export function App() {
  const info = useSettingsStore((state) => state.info)
  const error = useSettingsStore((state) => state.error)
  const init = useSettingsStore((state) => state.init)
  const [tab, setTab] = useState<TabId>('general')

  useEffect(() => init(), [init])

  return (
    <main className="mx-auto flex min-h-full max-w-3xl flex-col gap-5 px-8 py-8">
      <header className="flex items-center gap-3">
        <img src="./logo.png" alt="" className="h-7 w-7 rounded-lg" />
        <h1 className="text-xl font-semibold tracking-tight text-white">Glimpse</h1>
        {info !== null && (
          <span className="ml-auto text-xs text-white/40">
            v{info.version} · Electron {info.electron}
            {info.windowsBuild !== null && ` · Windows build ${info.windowsBuild}`}
          </span>
        )}
      </header>

      <nav className="flex gap-1 border-b border-hairline" aria-label="Settings sections">
        {TABS.map(({ id, label }) => (
          <button
            key={id}
            type="button"
            aria-current={tab === id ? 'page' : undefined}
            onClick={() => {
              setTab(id)
            }}
            className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium transition ${
              tab === id ? 'border-violet text-white' : 'border-transparent text-white/50 hover:text-white/80'
            }`}
          >
            {label}
          </button>
        ))}
      </nav>

      {error !== null && <ErrorBanner message={error} />}

      {tab === 'general' && <GeneralPage />}
      {tab === 'answers' && <AnswersPage />}
      {tab === 'notes' && <NotesPage />}
      {tab === 'audio' && <AudioPage />}
      {tab === 'companion' && <CompanionPage />}
      {tab === 'capture' && <CapturePage />}
      {tab === 'hotkeys' && <HotkeysPage />}
    </main>
  )
}
