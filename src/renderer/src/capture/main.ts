/**
 * Hidden capture page. Records the other side (system audio loopback) and you
 * (microphone), resamples both to 16 kHz mono in an AudioWorklet and streams
 * 100 ms chunks to the main process. Each source recovers on its own: device
 * unplugged → retry with backoff → after 5 failures it pauses until Retry.
 */
import { CircuitBreaker, backoffDelay } from '../../../shared/backoff'
import type { CaptureControl } from '../../../shared/ipc'
import type { AudioDevice, Source, SourceStatus } from '../../../shared/transcript'
import { subscribe } from '../ipc'

const SAMPLE_RATE = 16000
const CHUNK = SAMPLE_RATE / 10

let context: AudioContext | null = null
let sink: GainNode | null = null

async function audioContext(): Promise<{ context: AudioContext; sink: GainNode }> {
  if (context === null || sink === null) {
    context = new AudioContext({ sampleRate: SAMPLE_RATE })
    await context.audioWorklet.addModule('./pcm-tap.js')
    // The tap must be pulled by the graph, but nothing may be played back: route into a muted gain.
    sink = context.createGain()
    sink.gain.value = 0
    sink.connect(context.destination)
  }
  if (context.state !== 'running') await context.resume()
  return { context, sink }
}

function rms(samples: Float32Array): number {
  let sum = 0
  for (const sample of samples) sum += sample * sample
  return Math.sqrt(sum / samples.length)
}

const reports: Record<Source, SourceStatus> = {
  them: { state: 'off', label: 'System audio', message: '' },
  you: { state: 'off', label: 'Microphone', message: '' }
}
let devices: AudioDevice[] = []

function report(): void {
  void window.glimpse.invoke('capture:report', { them: reports.them, you: reports.you, devices })
}

class SourceCapture {
  private stream: MediaStream | null = null
  private nodes: AudioNode[] = []
  private retryTimer: ReturnType<typeof setTimeout> | null = null
  private readonly breaker = new CircuitBreaker(5)
  private wanted = false
  /** Bumped by every start/stop, so a slow acquire that finishes after a stop is discarded. */
  private generation = 0

  constructor(
    readonly source: Source,
    private readonly acquire: () => Promise<{ stream: MediaStream; note: string }>
  ) {}

  get live(): boolean {
    return this.stream !== null
  }

  get trackDeviceId(): string | null {
    return this.stream?.getAudioTracks()[0]?.getSettings().deviceId ?? null
  }

  private set(state: SourceStatus['state'], message: string, label?: string): void {
    reports[this.source] = { state, label: label ?? reports[this.source].label, message }
    report()
  }

  async start(): Promise<void> {
    this.wanted = true
    const generation = ++this.generation
    if (this.retryTimer !== null) clearTimeout(this.retryTimer)
    this.retryTimer = null
    this.teardown()
    if (this.breaker.open) return
    this.set('starting', 'Starting…')
    try {
      const { stream, note } = await this.acquire()
      if (generation !== this.generation) {
        for (const track of stream.getTracks()) track.stop()
        return
      }
      const track = stream.getAudioTracks()[0]
      if (track === undefined) throw new Error('No audio track')
      track.addEventListener('ended', () => {
        this.lost(new Error('The device stopped (unplugged or disabled).'))
      })
      const { context: ctx, sink: out } = await audioContext()
      const input = ctx.createMediaStreamSource(stream)
      const tap = new AudioWorkletNode(ctx, 'pcm-tap', { processorOptions: { chunk: CHUNK } })
      tap.port.onmessage = (event: MessageEvent<Float32Array>) => {
        window.glimpse.sendAudio(this.source, event.data, rms(event.data))
      }
      input.connect(tap)
      tap.connect(out)
      this.stream = stream
      this.nodes = [input, tap]
      this.breaker.recordSuccess()
      this.set('live', note, track.label || reports[this.source].label)
    } catch (error) {
      this.lost(error)
    }
  }

  private lost(error: unknown): void {
    this.teardown()
    if (!this.wanted) return
    const reason = error instanceof Error ? error.message : String(error)
    this.breaker.recordFailure()
    if (this.breaker.open) {
      this.set('paused', `Stopped after ${this.breaker.consecutiveFailures} failed attempts: ${reason}`)
      return
    }
    const delay = backoffDelay(this.breaker.consecutiveFailures)
    this.set('retrying', `${reason} Retrying in ${(delay / 1000).toFixed(1)} s.`)
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null
      void this.start()
    }, delay)
  }

  stop(state: 'off' | 'muted' | 'paused', message: string): void {
    this.wanted = false
    this.generation++
    if (this.retryTimer !== null) clearTimeout(this.retryTimer)
    this.retryTimer = null
    this.teardown()
    this.set(state, message)
  }

  resetBreaker(): void {
    this.breaker.reset()
  }

  private teardown(): void {
    for (const node of this.nodes) node.disconnect()
    this.nodes = []
    for (const track of this.stream?.getTracks() ?? []) track.stop()
    this.stream = null
  }
}

let control: CaptureControl = { micDeviceId: null, micEnabled: false, loopbackEnabled: false, paused: true, retry: 0 }

const loopback = new SourceCapture('them', async () => {
  // Main answers getDisplayMedia with the screen plus "loopback": the system audio mix. Only audio is kept.
  const stream = await navigator.mediaDevices.getDisplayMedia({ audio: true, video: true })
  for (const track of stream.getVideoTracks()) {
    track.stop()
    stream.removeTrack(track)
  }
  return { stream, note: 'Capturing what your speakers play (the other side of the call).' }
})

const constraints = (deviceId: string | null): MediaTrackConstraints => ({
  ...(deviceId === null ? {} : { deviceId: { exact: deviceId } }),
  echoCancellation: true,
  noiseSuppression: true,
  autoGainControl: true,
  channelCount: 1
})

const microphone = new SourceCapture('you', async () => {
  if (control.micDeviceId !== null) {
    try {
      return { stream: await navigator.mediaDevices.getUserMedia({ audio: constraints(control.micDeviceId) }), note: '' }
    } catch {
      // The chosen device is gone or busy: fall back to the Windows default so the call keeps working.
      return {
        stream: await navigator.mediaDevices.getUserMedia({ audio: constraints(null) }),
        note: 'The selected microphone is not available; using the system default.'
      }
    }
  }
  return { stream: await navigator.mediaDevices.getUserMedia({ audio: constraints(null) }), note: '' }
})

async function refreshDevices(): Promise<void> {
  const all = await navigator.mediaDevices.enumerateDevices()
  devices = all
    .filter((device) => device.kind === 'audioinput' && device.deviceId !== 'default' && device.deviceId !== 'communications')
    .map((device) => ({ deviceId: device.deviceId, label: device.label || 'Microphone' }))
  report()
}

let lastRetry = 0

async function apply(next: CaptureControl): Promise<void> {
  const micChanged = next.micDeviceId !== control.micDeviceId
  const retry = next.retry !== lastRetry
  lastRetry = next.retry
  control = next
  if (retry) {
    loopback.resetBreaker()
    microphone.resetBreaker()
  }

  if (next.paused) {
    loopback.stop('paused', 'Paused (panic hide).')
    microphone.stop('paused', 'Paused (panic hide).')
    return
  }
  if (!next.loopbackEnabled) loopback.stop('muted', 'Muted.')
  else if (!loopback.live || retry) await loopback.start()

  if (!next.micEnabled) microphone.stop('muted', 'Muted.')
  else if (!microphone.live || micChanged || retry) await microphone.start()
}

navigator.mediaDevices.addEventListener('devicechange', () => {
  void refreshDevices().then(() => {
    // A newly plugged-in microphone: if the mic is not live (or not on the chosen device), try again.
    if (control.micEnabled && !control.paused) {
      const onWanted = control.micDeviceId === null || microphone.trackDeviceId === control.micDeviceId
      if (!microphone.live || !onWanted) {
        microphone.resetBreaker()
        void microphone.start()
      }
    }
  })
})

subscribe('capture:control', (next) => {
  void apply(next)
})

void window.glimpse.invoke('capture:config', null).then(async (initial) => {
  await refreshDevices()
  await apply(initial)
  await refreshDevices()
})
