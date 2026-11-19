import { FlaskConical, ShieldCheck, Table2, Video } from 'lucide-react'
import { useEffect, useState } from 'react'
import {
  CAPTURE_APPS,
  CaptureAppSchema,
  type CaptureApp,
  type LiveMode,
  type LiveStatus,
  type MatrixRow,
  type OverlayState,
  type RemoteInfo,
  type SelfTestResult
} from '../../../shared/capture'
import { liveView } from '../../../shared/live'
import { errorMessage, subscribe } from '../ipc'
import { Badge, Button, Card, ErrorBanner } from '../ui'

const LIVE_DURATIONS = [30, 60, 120] as const

function verdictTone(verdict: SelfTestResult['verdict']): 'good' | 'bad' | 'warn' {
  return verdict === 'PASS' ? 'good' : verdict === 'FAIL' ? 'bad' : 'warn'
}

function RemoteBanner() {
  const [info, setInfo] = useState<RemoteInfo | null>(null)

  useEffect(() => {
    void window.glimpse.invoke('env:remote', null).then(setInfo)
  }, [])

  if (info === null || (!info.rdpSession && info.tools.length === 0)) return null
  const what = info.rdpSession ? 'a Remote Desktop session' : info.tools.join(', ')
  return (
    <div role="note" className="rounded-xl border border-amber-400/40 bg-amber-400/10 p-4 text-sm leading-relaxed text-amber-100">
      <div className="mb-1 font-semibold">Remote-viewing software found: {what}</div>
      <p className="text-xs text-amber-100/80">
        Streaming and remote-desktop tools capture your screen the same way a recorder does. If you are looking at this PC
        through one of them, <strong>the protected overlay is invisible to you too</strong>. That is the protection working,
        not a fault. To see the overlay, sit at the PC's own monitor. To test screen sharing, judge the result from the
        viewer's side, such as a phone or a second computer in the call, and run the control step first.
      </p>
    </div>
  )
}

function ProtectionCard({ state }: { state: OverlayState | null }) {
  const protection = state?.protection
  const excluded = protection !== undefined && protection.verified && (protection.method === 'exclude-from-capture' || protection.method === 'sharing-none')
  const tone = protection === undefined ? 'neutral' : excluded ? 'good' : 'warn'
  return (
    <Card title="Capture protection" icon={ShieldCheck} description="What the operating system reports for the overlay window right now.">
      {protection === undefined ? (
        <div className="text-sm text-white/50">Waiting for the overlay…</div>
      ) : (
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <Badge tone={tone}>
              {protection.method === 'exclude-from-capture' && protection.verified
                ? 'Excluded from capture · verified'
                : protection.method === 'sharing-none' && protection.verified
                  ? 'Hidden from sharing · run the test per app'
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
          {new Date(result.ranAt).toLocaleString()} · scale {result.scaleFactor}× · control saw{' '}
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
            <img src={result.protectedImage} alt="Capture with protection on" className="max-h-80 rounded-xl border border-hairline-strong" />
          )}
        </figure>
        <figure>
          <figcaption className="mb-1.5 text-xs font-medium text-white/70">Control, protection OFF (red = overlay pixels)</figcaption>
          {result.controlImage !== null && (
            <img src={result.controlImage} alt="Capture with protection off" className="max-h-80 rounded-xl border border-hairline-strong" />
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
  const [notSharing, setNotSharing] = useState(false)
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
    <Card title="Capture self-test" icon={FlaskConical}>
      <p className="mb-3 text-xs leading-relaxed text-white/55">
        Paints the overlay with a magenta/green pattern, captures this display the way a screen recorder does, and checks
        the overlay is absent. A control capture with protection switched off for a moment proves the test can see it.
        For about half a second protection is off, so the pattern <strong className="text-white/80">will appear in any
        recording or screen share that is running</strong>. Don't run this while sharing or streaming. Use the live test
        below for that.
      </p>
      <label className="mb-3 flex items-center gap-2 text-sm text-white/80">
        <input
          type="checkbox"
          className="accent-violet"
          checked={notSharing}
          onChange={(event) => {
            setNotSharing(event.target.checked)
          }}
        />
        I am not sharing my screen or recording right now
      </label>
      <div className="mb-4 flex items-center gap-3">
        <Button onClick={() => void run()} disabled={running || !notSharing}>
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
  const [status, setStatus] = useState<LiveStatus>({ endsAt: null, mode: null })
  const [now, setNow] = useState(() => Date.now())
  const [app, setApp] = useState<CaptureApp>('Zoom')
  const [visible, setVisible] = useState<boolean | null>(null)
  const [notes, setNotes] = useState('')
  const [error, setError] = useState<string | null>(null)

  // Ask main for the truth on mount and whenever the window regains focus, so a lost event cannot leave the card stuck.
  useEffect(() => {
    const refresh = (): void => {
      void window.glimpse.invoke('live:get', null).then((current) => {
        setStatus(current)
        setNow(Date.now())
      })
    }
    refresh()
    window.addEventListener('focus', refresh)
    const unsubscribe = subscribe('live:status', setStatus)
    return () => {
      window.removeEventListener('focus', refresh)
      unsubscribe()
    }
  }, [])

  useEffect(() => {
    if (status.endsAt === null) return
    const timer = setInterval(() => {
      setNow(Date.now())
    }, 500)
    return () => {
      clearInterval(timer)
    }
  }, [status.endsAt])

  // Derived from the end time as well as the events: once the time has passed the card is idle again.
  const { running, secondsLeft, mode } = liveView(status, now)

  const begin = async (kind: LiveMode): Promise<void> => {
    setError(null)
    try {
      const next =
        kind === 'control'
          ? await window.glimpse.invoke('live:control', { seconds: 5 })
          : await window.glimpse.invoke('live:start', { seconds: duration })
      setStatus(next)
      setNow(Date.now())
    } catch (caught) {
      setError(errorMessage(caught))
    }
  }

  const stop = async (): Promise<void> => {
    setError(null)
    try {
      setStatus(await window.glimpse.invoke('live:stop', null))
    } catch (caught) {
      // Even if stopping failed on the main side, do not leave the buttons disabled.
      setStatus({ endsAt: null, mode: null })
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
    <Card title="Live test with a real recorder" icon={Video}>
      <ol className="mb-4 list-decimal space-y-1.5 pl-5 text-xs leading-relaxed text-white/55">
        <li>Start your recording or screen share (Zoom, Meet, Teams, OBS, Loom, Discord, Game Bar…).</li>
        <li>
          <strong className="text-white/80">Step 1, control.</strong> The pattern is shown <em>without</em> protection for 5
          seconds. It <strong className="text-white/80">must appear</strong> in your recording or on the viewer&apos;s screen.
          If it doesn&apos;t, this setup can&apos;t see your screen and step 2 proves nothing.
        </li>
        <li>
          <strong className="text-white/80">Step 2, protected.</strong> The pattern is shown with protection on. It{' '}
          <strong className="text-white/80">must not appear</strong> in the recording or on the viewer&apos;s screen. Judge
          from the viewer&apos;s side (a phone or second computer in the call). If you are viewing this PC remotely, you won&apos;t
          see it either.
        </li>
        <li>Report what you saw below. This fills in the capture matrix.</li>
      </ol>
      {error !== null && <ErrorBanner message={error} />}
      <div className="my-3 flex flex-wrap items-center gap-3">
        <Button tone="ghost" onClick={() => void begin('control')} disabled={running}>
          Step 1: Control (5 s)
        </Button>
        <select
          className="h-9 cursor-pointer rounded-lg border border-hairline-strong bg-ink/70 px-3 text-[13px] text-white transition focus:border-violet/60 focus:outline-none focus:ring-2 focus:ring-violet/25"
          value={duration}
          disabled={running}
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
        <Button onClick={() => void begin('protected')} disabled={running}>
          Step 2: Protected pattern
        </Button>
        {running && (
          <>
            <Badge tone={mode === 'control' ? 'bad' : 'warn'}>
              {mode === 'control' ? 'Control: visible to recorders' : 'Protected pattern on'} · {secondsLeft}s
            </Badge>
            <Button tone="ghost" onClick={() => void stop()}>
              Stop
            </Button>
          </>
        )}
      </div>

      <div className="mt-4 space-y-3 border-t border-hairline pt-4">
        <div className="flex flex-wrap items-center gap-3">
          <select
            className="h-9 cursor-pointer rounded-lg border border-hairline-strong bg-ink/70 px-3 text-[13px] text-white transition focus:border-violet/60 focus:outline-none focus:ring-2 focus:ring-violet/25"
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
            <input
              type="radio"
              name="seen"
              className="accent-violet"
              checked={visible === false}
              onChange={() => {
                setVisible(false)
              }}
            />
            Control seen, protected pattern not seen (PASS)
          </label>
          <label className="flex items-center gap-1.5 text-sm text-white/80">
            <input
              type="radio"
              name="seen"
              className="accent-violet"
              checked={visible === true}
              onChange={() => {
                setVisible(true)
              }}
            />
            Protected pattern seen (FAIL)
          </label>
        </div>
        <input
          type="text"
          maxLength={500}
          placeholder="Notes (app version, capture mode, how you viewed it…)"
          value={notes}
          onChange={(event) => {
            setNotes(event.target.value)
          }}
          className="w-full h-9 cursor-pointer rounded-lg border border-hairline-strong bg-ink/70 px-3 text-[13px] text-white transition focus:border-violet/60 focus:outline-none focus:ring-2 focus:ring-violet/25 placeholder:text-white/30"
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
    <Card title="Capture matrix" icon={Table2} description="Your results per app, kept on this PC.">
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
      <RemoteBanner />
      <ProtectionCard state={state} />
      <SelfTestCard />
      <LiveCard onReported={setMatrix} />
      <MatrixCard rows={matrix} />
    </div>
  )
}
