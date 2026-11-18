import { useEffect, useState } from 'react'
import {
  CAPTURE_APPS,
  CaptureAppSchema,
  type CaptureApp,
  type MatrixRow,
  type OverlayState,
  type SelfTestResult
} from '../../../shared/capture'
import { errorMessage, subscribe } from '../ipc'
import { Badge, Button, Card, ErrorBanner } from '../ui'

const LIVE_DURATIONS = [30, 60, 120] as const

function verdictTone(verdict: SelfTestResult['verdict']): 'good' | 'bad' | 'warn' {
  return verdict === 'PASS' ? 'good' : verdict === 'FAIL' ? 'bad' : 'warn'
}

function ProtectionCard({ state }: { state: OverlayState | null }) {
  const protection = state?.protection
  const tone = protection === undefined ? 'neutral' : protection.verified && protection.method === 'exclude-from-capture' ? 'good' : 'warn'
  return (
    <Card title="Capture protection">
      {protection === undefined ? (
        <div className="text-sm text-white/50">Waiting for the overlay…</div>
      ) : (
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <Badge tone={tone}>
              {protection.method === 'exclude-from-capture' && protection.verified
                ? 'Excluded from capture · verified'
                : protection.method === 'monitor-only'
                  ? 'Capture-safe mode (black box in captures)'
                  : 'Not confirmed'}
            </Badge>
            {state?.panic === true && <Badge tone="warn">Panic mode</Badge>}
          </div>
          <p className="text-xs text-white/55">{protection.detail}</p>
        </div>
      )}
    </Card>
  )
}

function ResultView({ result }: { result: SelfTestResult }) {
  const { cols, rows } = result.grid
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Badge tone={verdictTone(result.verdict)}>{result.verdict}</Badge>
        <span className="text-xs text-white/50">
          {new Date(result.ranAt).toLocaleString()} · display {result.displayId} · scale {result.scaleFactor}× · control saw{' '}
          {(result.controlDetectedFraction * 100).toFixed(0)}% of the overlay
        </span>
      </div>
      <ul className="space-y-1 text-xs text-white/60">
        {result.notes.map((note) => (
          <li key={note}>{note}</li>
        ))}
      </ul>
      <div className="grid gap-4 sm:grid-cols-2">
        <figure>
          <figcaption className="mb-1.5 text-xs font-medium text-white/70">Protection ON, what a recorder sees</figcaption>
          {result.protectedImage !== null && (
            <img src={result.protectedImage} alt="Capture with protection on" className="max-h-80 rounded-md border border-hairline" />
          )}
        </figure>
        <figure>
          <figcaption className="mb-1.5 text-xs font-medium text-white/70">Control, protection OFF (red = overlay pixels)</figcaption>
          {result.controlImage !== null && (
            <img src={result.controlImage} alt="Capture with protection off" className="max-h-80 rounded-md border border-hairline" />
          )}
        </figure>
      </div>
      <div>
        <div className="mb-1.5 text-xs font-medium text-white/70">Overlay pixels per region (protection ON)</div>
        <div className="grid gap-1" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`, maxWidth: 260 }}>
          {result.protectedRegions.map((region) => (
            <div
              key={`${region.row}-${region.col}`}
              title={`row ${region.row + 1}, col ${region.col + 1}`}
              className={`rounded px-2 py-1 text-center text-[11px] font-medium ${
                region.status === 'PASS' ? 'bg-emerald-400/15 text-emerald-300' : 'bg-red-500/20 text-red-300'
              }`}
            >
              {region.canaryPixels}
            </div>
          ))}
        </div>
        <div className="mt-1 text-[11px] text-white/40">{rows} rows × {cols} columns</div>
      </div>
    </div>
  )
}

function SelfTestCard() {
  const [result, setResult] = useState<SelfTestResult | null>(null)
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    void window.glimpse.invoke('selftest:last', null).then(setResult)
  }, [])

  const run = async (): Promise<void> => {
    setRunning(true)
    setError(null)
    try {
      setResult(await window.glimpse.invoke('selftest:run', null))
    } catch (caught) {
      setError(errorMessage(caught))
    } finally {
      setRunning(false)
    }
  }

  return (
    <Card title="Capture self-test">
      <p className="mb-3 text-xs leading-relaxed text-white/55">
        Paints the overlay with a magenta/green pattern, captures this display the way a screen recorder does, and checks
        the overlay is absent. A control capture with protection switched off for a moment proves the test can see it.
        The pattern is briefly visible on your screen, so don't run this during a live screen share. Use the live test
        below instead.
      </p>
      <div className="mb-4 flex items-center gap-3">
        <Button onClick={() => void run()} disabled={running}>
          {running ? 'Running…' : 'Run self-test'}
        </Button>
      </div>
      {error !== null && <ErrorBanner message={error} />}
      {result !== null ? <ResultView result={result} /> : <div className="text-sm text-white/45">No test has been run yet.</div>}
    </Card>
  )
}

function LiveCard({ onReported }: { onReported: (rows: MatrixRow[]) => void }) {
  const [duration, setDuration] = useState<number>(60)
  const [endsAt, setEndsAt] = useState<number | null>(null)
  const [now, setNow] = useState(() => Date.now())
  const [app, setApp] = useState<CaptureApp>('Zoom')
  const [visible, setVisible] = useState<boolean | null>(null)
  const [notes, setNotes] = useState('')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => subscribe('live:status', ({ endsAt: next }) => {
    setEndsAt(next)
  }), [])

  useEffect(() => {
    if (endsAt === null) return
    const timer = setInterval(() => {
      setNow(Date.now())
    }, 500)
    return () => {
      clearInterval(timer)
    }
  }, [endsAt])

  const secondsLeft = endsAt === null ? 0 : Math.max(0, Math.ceil((endsAt - now) / 1000))

  const start = async (): Promise<void> => {
    setError(null)
    try {
      const status = await window.glimpse.invoke('live:start', { seconds: duration })
      setEndsAt(status.endsAt)
      setNow(Date.now())
    } catch (caught) {
      setError(errorMessage(caught))
    }
  }

  const report = async (): Promise<void> => {
    if (visible === null) return
    try {
      onReported(await window.glimpse.invoke('live:report', { app, overlayVisible: visible, notes }))
      setVisible(null)
      setNotes('')
      setError(null)
    } catch (caught) {
      setError(errorMessage(caught))
    }
  }

  return (
    <Card title="Live test with a real recorder">
      <ol className="mb-4 list-decimal space-y-1 pl-5 text-xs leading-relaxed text-white/55">
        <li>Start your recording or screen share (Zoom, Meet, Teams, OBS, Loom, Discord, Game Bar…).</li>
        <li>Press <strong className="text-white/80">Show pattern</strong>. The overlay paints the magenta/green pattern for the chosen time.</li>
        <li>Look at the recording or what the other side sees. The pattern should be absent, even though you can see it.</li>
        <li>Report below what you saw. This fills in the capture matrix.</li>
      </ol>
      {error !== null && <ErrorBanner message={error} />}
      <div className="my-3 flex flex-wrap items-center gap-3">
        <select
          className="rounded-md border border-hairline bg-ink px-3 py-1.5 text-sm text-white"
          value={duration}
          disabled={endsAt !== null}
          onChange={(event) => {
            setDuration(Number(event.target.value))
          }}
        >
          {LIVE_DURATIONS.map((seconds) => (
            <option key={seconds} value={seconds}>
              {seconds} seconds
            </option>
          ))}
        </select>
        {endsAt === null ? (
          <Button onClick={() => void start()}>Show pattern</Button>
        ) : (
          <>
            <Badge tone="warn">Pattern on · {secondsLeft}s</Badge>
            <Button tone="ghost" onClick={() => void window.glimpse.invoke('live:stop', null)}>
              Stop
            </Button>
          </>
        )}
      </div>

      <div className="mt-4 space-y-3 border-t border-hairline pt-4">
        <div className="flex flex-wrap items-center gap-3">
          <select
            className="rounded-md border border-hairline bg-ink px-3 py-1.5 text-sm text-white"
            value={app}
            onChange={(event) => {
              const parsed = CaptureAppSchema.safeParse(event.target.value)
              if (parsed.success) setApp(parsed.data)
            }}
          >
            {CAPTURE_APPS.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
          <label className="flex items-center gap-1.5 text-sm text-white/80">
            <input type="radio" name="seen" className="accent-violet" checked={visible === false} onChange={() => { setVisible(false) }} />
            Overlay not visible (PASS)
          </label>
          <label className="flex items-center gap-1.5 text-sm text-white/80">
            <input type="radio" name="seen" className="accent-violet" checked={visible === true} onChange={() => { setVisible(true) }} />
            Overlay visible (FAIL)
          </label>
        </div>
        <input
          type="text"
          maxLength={500}
          placeholder="Notes (app version, capture mode…)"
          value={notes}
          onChange={(event) => {
            setNotes(event.target.value)
          }}
          className="w-full rounded-md border border-hairline bg-ink px-3 py-1.5 text-sm text-white placeholder:text-white/30"
        />
        <Button onClick={() => void report()} disabled={visible === null}>
          Save result
        </Button>
      </div>
    </Card>
  )
}

function MatrixCard({ rows }: { rows: MatrixRow[] }) {
  return (
    <Card title="Capture matrix">
      {rows.length === 0 ? (
        <div className="text-sm text-white/45">No live results yet.</div>
      ) : (
        <table className="w-full text-left text-sm">
          <thead className="text-xs text-white/45">
            <tr>
              <th className="pb-2 font-medium">App</th>
              <th className="pb-2 font-medium">Result</th>
              <th className="pb-2 font-medium">Notes</th>
              <th className="pb-2 font-medium">Tested</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.app} className="border-t border-hairline">
                <td className="py-2 text-white">{row.app}</td>
                <td className="py-2">
                  <Badge tone={row.result === 'PASS' ? 'good' : 'bad'}>{row.result}</Badge>
                </td>
                <td className="py-2 text-xs text-white/60">{row.notes}</td>
                <td className="py-2 text-xs text-white/45">
                  {new Date(row.testedAt).toLocaleDateString()}
                  {row.windowsBuild !== null && ` · build ${row.windowsBuild}`}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Card>
  )
}

export function CapturePage() {
  const [state, setState] = useState<OverlayState | null>(null)
  const [matrix, setMatrix] = useState<MatrixRow[]>([])

  useEffect(() => {
    void window.glimpse.invoke('overlay:state', null).then(setState)
    void window.glimpse.invoke('live:matrix', null).then(setMatrix)
    return subscribe('overlay:state', setState)
  }, [])

  return (
    <div className="space-y-5">
      <ProtectionCard state={state} />
      <SelfTestCard />
      <LiveCard onReported={setMatrix} />
      <MatrixCard rows={matrix} />
    </div>
  )
}
