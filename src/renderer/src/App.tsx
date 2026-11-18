import { useEffect, type ReactNode } from 'react'
import { ModeSchema, type Mode } from '../../shared/settings'
import { useSettingsStore } from './store'

const MODE_LABELS: Record<Mode, string> = {
  general: 'General',
  interview: 'Interview',
  sales: 'Sales call',
  technical: 'Technical',
  recap: 'Recap'
}

function Row({ label, hint, children }: { label: string; hint: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-6 border-b border-hairline py-4 last:border-b-0">
      <div>
        <div className="text-sm font-medium text-white">{label}</div>
        <div className="text-xs text-white/50">{hint}</div>
      </div>
      {children}
    </div>
  )
}

export function App() {
  const { info, settings, error, load, update } = useSettingsStore()

  useEffect(() => {
    void load()
  }, [load])

  return (
    <main className="mx-auto flex h-full max-w-3xl flex-col gap-6 px-8 py-8">
      <header className="flex items-center gap-3">
        <span className="h-2.5 w-2.5 rounded-full bg-violet shadow-[0_0_12px_var(--color-violet)]" />
        <h1 className="text-xl font-semibold tracking-tight text-white">Glimpse</h1>
        {info !== null && (
          <span className="ml-auto text-xs text-white/40">
            v{info.version} · Electron {info.electron}
            {info.windowsBuild !== null && ` · Windows build ${info.windowsBuild}`}
          </span>
        )}
      </header>

      {error !== null && (
        <div role="alert" className="rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-200">
          {error}
        </div>
      )}

      {settings === null ? (
        <div className="text-sm text-white/50">Loading settings…</div>
      ) : (
        <section className="rounded-xl border border-hairline bg-panel px-5">
          <Row label="Mode" hint="Prompt template used for answers">
            <select
              className="rounded-md border border-hairline bg-ink px-3 py-1.5 text-sm text-white"
              value={settings.mode}
              onChange={(event) => {
                const parsed = ModeSchema.safeParse(event.target.value)
                if (parsed.success) void update({ mode: parsed.data })
              }}
            >
              {ModeSchema.options.map((mode) => (
                <option key={mode} value={mode}>
                  {MODE_LABELS[mode]}
                </option>
              ))}
            </select>
          </Row>
          <Row label="Click-through" hint="Clicks pass through the overlay to the app behind it">
            <input
              type="checkbox"
              className="h-4 w-4 accent-violet"
              checked={settings.clickThrough}
              onChange={(event) => void update({ clickThrough: event.target.checked })}
            />
          </Row>
          <Row label="Overlay opacity" hint={`${Math.round(settings.overlayOpacity * 100)}%`}>
            <input
              type="range"
              min={0.15}
              max={1}
              step={0.05}
              className="w-40 accent-violet"
              value={settings.overlayOpacity}
              onChange={(event) => void update({ overlayOpacity: Number(event.target.value) })}
            />
          </Row>
          <Row label="Launch at login" hint="Start Glimpse in the tray when you sign in to Windows">
            <input
              type="checkbox"
              className="h-4 w-4 accent-violet"
              checked={settings.launchAtLogin}
              onChange={(event) => void update({ launchAtLogin: event.target.checked })}
            />
          </Row>
        </section>
      )}
    </main>
  )
}
