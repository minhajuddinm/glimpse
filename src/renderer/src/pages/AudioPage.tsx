import { useEffect, useState } from 'react'
import type { AudioDevice, AudioLevels, AudioStatus, CaptureState, SourceStatus, TranscriptSnapshot } from '../../../shared/transcript'
import { subscribe } from '../ipc'
import { useSettingsStore } from '../store'
import { Badge, Button, Card, Row } from '../ui'

const STATE_TONE: Record<CaptureState, 'good' | 'bad' | 'warn' | 'neutral'> = {
  live: 'good',
  starting: 'neutral',
  off: 'neutral',
  muted: 'neutral',
  retrying: 'warn',
  paused: 'bad',
  error: 'bad'
}

/** Speech RMS mapped to 0–1 on a -60…0 dBFS scale. */
function meterFraction(rms: number): number {
  if (rms <= 0) return 0
  return Math.max(0, Math.min(1, (20 * Math.log10(rms) + 60) / 60))
}

function Meter({ level }: { level: number }) {
  const fraction = meterFraction(level)
  return (
    <div className="h-2 w-40 overflow-hidden rounded-full bg-white/10" role="meter" aria-valuemin={0} aria-valuemax={1} aria-valuenow={fraction}>
      <div
        className={`h-full rounded-full transition-[width] duration-100 ${fraction > 0.85 ? 'bg-amber-400' : 'bg-emerald-400'}`}
        style={{ width: `${(fraction * 100).toFixed(0)}%` }}
      />
    </div>
  )
}

function SourceRow({ title, status, level, muted, onMute }: { title: string; status: SourceStatus; level: number; muted: boolean; onMute: (muted: boolean) => void }) {
  return (
    <div className="border-b border-hairline py-4 last:border-b-0">
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-sm font-medium text-white">
            {title}
            <Badge tone={STATE_TONE[status.state]}>{status.state}</Badge>
          </div>
          <div className="truncate text-xs text-white/50" title={status.label}>
            {status.label}
          </div>
        </div>
        <div className="flex items-center gap-4">
          <Meter level={level} />
          <label className="flex items-center gap-1.5 text-xs text-white/70">
            <input type="checkbox" className="accent-violet" checked={muted} onChange={(event) => { onMute(event.target.checked) }} />
            Mute
          </label>
        </div>
      </div>
      {status.message !== '' && <p className="mt-1.5 text-xs text-white/55">{status.message}</p>}
    </div>
  )
}

export function AudioPage() {
  const { settings, update } = useSettingsStore()
  const [status, setStatus] = useState<AudioStatus | null>(null)
  const [levels, setLevels] = useState<AudioLevels>({ them: 0, you: 0 })
  const [devices, setDevices] = useState<AudioDevice[]>([])
  const [transcript, setTranscript] = useState<TranscriptSnapshot>({ segments: [], partials: { them: '', you: '' } })

  useEffect(() => {
    void window.glimpse.invoke('audio:status', null).then(setStatus)
    void window.glimpse.invoke('audio:devices', null).then(setDevices)
    void window.glimpse.invoke('transcript:get', null).then(setTranscript)
    const unsubscribers = [
      subscribe('audio:status', (next) => {
        setStatus(next)
        void window.glimpse.invoke('audio:devices', null).then(setDevices)
      }),
      subscribe('audio:levels', setLevels),
      subscribe('transcript:update', setTranscript)
    ]
    return () => {
      for (const unsubscribe of unsubscribers) unsubscribe()
    }
  }, [])

  if (settings === null || status === null) return <div className="text-sm text-white/50">Loading audio…</div>

  const asrTone = status.asr.state === 'ready' ? 'good' : status.asr.state === 'loading' || status.asr.state === 'restarting' ? 'warn' : 'bad'
  const recent = transcript.segments.slice(-12)

  return (
    <div className="space-y-5">
      <Card title="Sources">
        <SourceRow title="Them (system audio)" status={status.them} level={levels.them} muted={settings.loopbackMuted} onMute={(muted) => void update({ loopbackMuted: muted })} />
        <SourceRow title="You (microphone)" status={status.you} level={levels.you} muted={settings.micMuted} onMute={(muted) => void update({ micMuted: muted })} />
        <Row label="Microphone" hint="Glimpse falls back to the Windows default if this one is unplugged">
          <select
            className="max-w-64 rounded-md border border-hairline bg-ink px-3 py-1.5 text-sm text-white"
            value={settings.micDeviceId ?? ''}
            onChange={(event) => void update({ micDeviceId: event.target.value === '' ? null : event.target.value })}
          >
            <option value="">Windows default</option>
            {devices.map((device) => (
              <option key={device.deviceId} value={device.deviceId}>
                {device.label}
              </option>
            ))}
          </select>
        </Row>
        <p className="pt-3 text-xs text-white/45">
          System audio is whatever plays through your default speakers or headset. To capture another output, make it the Windows default.
        </p>
      </Card>

      <Card title="Speech recognition (on this PC)">
        <div className="flex flex-wrap items-center gap-3">
          <Badge tone={asrTone}>{status.asr.state}</Badge>
          <select
            className="rounded-md border border-hairline bg-ink px-3 py-1.5 text-sm text-white"
            value={settings.asrModel}
            onChange={(event) => {
              const value = event.target.value
              if (value === 'kroko-en' || value === 'nemotron-0.6b') void update({ asrModel: value })
            }}
          >
            <option value="kroko-en">Kroko (fast, 55 MB)</option>
            <option value="nemotron-0.6b">Nemotron 0.6B (larger, slower)</option>
          </select>
          <span className="text-xs text-white/55">
            Speech end → text: {status.latency.p50 === null ? 'no data yet' : `p50 ${status.latency.p50} ms · p95 ${status.latency.p95 ?? '?'} ms (${status.latency.samples} lines)`}
          </span>
          <span className="ml-auto">
            <Button tone="ghost" onClick={() => void window.glimpse.invoke('audio:retry', null)}>
              Retry
            </Button>
          </span>
        </div>
        {status.asr.message !== '' && <p className="mt-2 text-xs text-white/55">{status.asr.message}</p>}
      </Card>

      <Card title="Live transcript">
        <div className="mb-3 flex justify-end">
          <Button tone="ghost" onClick={() => void window.glimpse.invoke('transcript:clear', null)}>
            Clear
          </Button>
        </div>
        {recent.length === 0 && transcript.partials.them === '' && transcript.partials.you === '' ? (
          <p className="text-sm text-white/45">Nothing yet. Speak, or play something with voices in it.</p>
        ) : (
          <ol className="space-y-1.5 text-sm">
            {recent.map((segment) => (
              <li key={segment.id} className={segment.source === 'you' ? 'text-right' : ''}>
                <span className={`mr-2 text-xs font-semibold ${segment.source === 'you' ? 'text-emerald-300' : 'text-violet-300'}`}>
                  {segment.source === 'you' ? 'You' : 'Them'}
                </span>
                <span className="text-white/85">{segment.text}</span>
                {segment.latencyMs !== null && <span className="ml-2 text-[10px] text-white/30">{Math.round(segment.latencyMs)} ms</span>}
              </li>
            ))}
            {transcript.partials.them !== '' && <li className="italic text-white/45">Them: {transcript.partials.them}…</li>}
            {transcript.partials.you !== '' && <li className="text-right italic text-white/45">You: {transcript.partials.you}…</li>}
          </ol>
        )}
      </Card>
    </div>
  )
}
