import { useEffect, useState } from 'react'
import { Cpu, Eraser, Mic, MicOff, RotateCw, ScrollText, Speaker, VolumeX, type LucideIcon } from 'lucide-react'
import type { AudioDevice, AudioLevels, AudioStatus, CaptureState, SourceStatus, TranscriptSnapshot } from '../../../shared/transcript'
import { subscribe } from '../ipc'
import { OS_NAME } from '../platform'
import { useSettingsStore } from '../store'
import { Badge, Button, Card, EmptyState, Loading, Row, Select } from '../ui'

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

/** A segmented level meter: 20 bars that light up with the signal. */
function Meter({ level, muted }: { level: number; muted: boolean }) {
  const fraction = muted ? 0 : meterFraction(level)
  const lit = Math.round(fraction * 20)
  return (
    <div className="flex h-7 items-end gap-[3px]" role="meter" aria-label="Input level" aria-valuemin={0} aria-valuemax={1} aria-valuenow={fraction}>
      {Array.from({ length: 20 }, (_, index) => (
        <span
          key={index}
          className={`w-[5px] rounded-sm transition-colors duration-100 ${
            index < lit ? (index >= 17 ? 'bg-amber-400' : 'bg-gradient-to-t from-violet to-indigo') : 'bg-white/[0.07]'
          }`}
          style={{ height: `${String(30 + index * 3.5)}%` }}
        />
      ))}
    </div>
  )
}

function SourceCard({
  title,
  subtitle,
  icon: Icon,
  status,
  level,
  muted,
  onMute
}: {
  title: string
  subtitle: string
  icon: LucideIcon
  status: SourceStatus
  level: number
  muted: boolean
  onMute: (muted: boolean) => void
}) {
  return (
    <div className={`rounded-xl border p-4 transition ${status.state === 'live' ? 'border-violet/25 bg-violet/[0.04]' : 'border-hairline bg-white/[0.015]'}`}>
      <div className="flex items-start gap-3">
        <div className={`grid h-9 w-9 shrink-0 place-items-center rounded-lg ${status.state === 'live' ? 'brand-gradient text-white' : 'bg-white/[0.05] text-text-faint'}`}>
          <Icon className="h-4 w-4" aria-hidden />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-[13.5px] font-semibold text-white">{title}</span>
            <Badge tone={STATE_TONE[status.state]} dot={status.state === 'live'}>
              {status.state}
            </Badge>
          </div>
          <div className="truncate text-xs text-text-faint" title={status.label}>
            {status.label !== '' ? status.label : subtitle}
          </div>
        </div>
        <Button size="sm" tone={muted ? 'danger' : 'ghost'} icon={muted ? (Icon === Mic ? MicOff : VolumeX) : Icon} onClick={() => { onMute(!muted) }}>
          {muted ? 'Muted' : 'Mute'}
        </Button>
      </div>
      <div className="mt-3">
        <Meter level={level} muted={muted} />
      </div>
      {status.message !== '' && <p className="mt-2 text-xs leading-relaxed text-text-faint">{status.message}</p>}
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

  if (settings === null || status === null) return <Loading label="Loading audio" />

  const asrTone = status.asr.state === 'ready' ? 'good' : status.asr.state === 'loading' || status.asr.state === 'restarting' ? 'warn' : 'bad'
  const recent = transcript.segments.slice(-12)

  return (
    <>
      <div className="grid animate-fade-up grid-cols-2 gap-3">
        <SourceCard title="Them" subtitle="System audio" icon={Speaker} status={status.them} level={levels.them} muted={settings.loopbackMuted} onMute={(muted) => void update({ loopbackMuted: muted })} />
        <SourceCard title="You" subtitle="Microphone" icon={Mic} status={status.you} level={levels.you} muted={settings.micMuted} onMute={(muted) => void update({ micMuted: muted })} />
      </div>

      <Card title="Devices" icon={Mic}>
        <Row label="Microphone" hint="If it is unplugged, Glimpse falls back to the system default and switches back when it returns">
          <Select
            value={settings.micDeviceId ?? ''}
            options={[{ value: '', label: 'System default' }, ...devices.map((device) => ({ value: device.deviceId, label: device.label }))]}
            onChange={(value) => void update({ micDeviceId: value === '' ? null : value })}
          />
        </Row>
        <p className="mt-3 text-xs leading-relaxed text-text-faint">
          “Them” is whatever plays through your default speakers or headset. To capture another output, make it the {OS_NAME} default.
        </p>
      </Card>

      <Card
        title="Speech recognition"
        icon={Cpu}
        description="Runs entirely on this PC. Audio is never uploaded."
        actions={
          <Badge tone={asrTone} dot={asrTone === 'good'}>
            {status.asr.state}
          </Badge>
        }
      >
        <Row label="Model" hint="Kroko is fast and accurate for English; Nemotron is larger and slower">
          <Select
            value={settings.asrModel}
            options={[
              { value: 'kroko-en', label: 'Kroko · fast (55 MB)' },
              { value: 'nemotron-0.6b', label: 'Nemotron 0.6B · larger' }
            ]}
            onChange={(value) => void update({ asrModel: value })}
          />
        </Row>
        <Row
          label="Speed"
          hint={
            status.latency.p50 === null
              ? 'Time from the end of speech to text appears here once someone talks'
              : `End of speech → text: typically ${String(status.latency.p50)} ms, slowest ${String(status.latency.p95 ?? '?')} ms (${String(status.latency.samples)} lines)`
          }
        >
          <Button tone="ghost" size="sm" icon={RotateCw} onClick={() => void window.glimpse.invoke('audio:retry', null)}>
            Restart
          </Button>
        </Row>
        {status.asr.message !== '' && <p className="mt-3 text-xs text-text-faint">{status.asr.message}</p>}
      </Card>

      <Card
        title="Live transcript"
        icon={ScrollText}
        actions={
          <Button tone="subtle" size="sm" icon={Eraser} onClick={() => void window.glimpse.invoke('transcript:clear', null)}>
            Clear
          </Button>
        }
      >
        {recent.length === 0 && transcript.partials.them === '' && transcript.partials.you === '' ? (
          <EmptyState icon={ScrollText} title="Listening…">
            Speak, or play something with voices in it. Lines from the other side appear on the left, yours on the right.
          </EmptyState>
        ) : (
          <ol className="space-y-2">
            {recent.map((segment) => (
              <li key={segment.id} className={`flex ${segment.source === 'you' ? 'justify-end' : ''}`}>
                <div
                  className={`max-w-[80%] rounded-2xl px-3.5 py-2 text-[13px] leading-relaxed ${
                    segment.source === 'you' ? 'rounded-br-md bg-emerald-400/[0.08] text-emerald-50' : 'rounded-bl-md bg-white/[0.05] text-text'
                  }`}
                >
                  <div className={`mb-0.5 text-[10px] font-semibold uppercase tracking-wider ${segment.source === 'you' ? 'text-emerald-300/80' : 'text-violet-soft'}`}>
                    {segment.source === 'you' ? 'You' : 'Them'}
                    {segment.latencyMs !== null && <span className="ml-2 font-normal normal-case tracking-normal text-text-faint">{Math.round(segment.latencyMs)} ms</span>}
                  </div>
                  {segment.text}
                </div>
              </li>
            ))}
            {transcript.partials.them !== '' && <li className="text-[13px] italic text-text-faint">Them: {transcript.partials.them}…</li>}
            {transcript.partials.you !== '' && <li className="text-right text-[13px] italic text-text-faint">You: {transcript.partials.you}…</li>}
          </ol>
        )}
      </Card>
    </>
  )
}
