import type { Source } from '../../shared/transcript'
import type { OnlineRecognizer, OnlineStream, VoiceDetector } from './sherpa-types'

export const SAMPLE_RATE = 16000
/**
 * Silence fed instantly when an utterance ends, so the model sees enough right
 * context for the last words: Kroko needs ~1.5 s of trailing context in total (the
 * 400 ms VAD hangover plus this). Measured with npm run bench:pipeline.
 */
export const PAD_MS = 1200

/** With a voice detector, a stream that has heard nothing for this long is replaced, so silence never accumulates. */
export const IDLE_RECYCLE_MS = 10_000

export type AsrEvent =
  | { readonly kind: 'partial'; readonly source: Source; readonly text: string }
  | {
      readonly kind: 'final'
      readonly source: Source
      readonly text: string
      /** Audio time from the last change in the text (≈ end of speech) to the endpoint, plus finishing compute. */
      readonly latencyMs: number
    }

/**
 * Streaming recognition for one side of the call. Partial text is emitted while
 * someone speaks; when the recogniser detects an endpoint (trailing silence) the
 * utterance is padded, finished and emitted as final, and a fresh stream starts.
 */
export class SourceRecognizer {
  private readonly recognizer: OnlineRecognizer
  readonly source: Source
  private readonly emit: (event: AsrEvent) => void
  private readonly now: () => number
  private stream: OnlineStream
  private audioMs = 0
  private lastText = ''
  private lastChangeAtMs = 0
  private readonly vad: VoiceDetector | null
  /** The detector keeps reporting speech for this long after the voice stops; added back when measuring latency. */
  private readonly hangoverMs: number
  private heardSpeech = false
  /** Audio time the voice detector last reported speech. */
  private lastVoiceAtMs = 0
  private streamStartMs = 0

  constructor(
    recognizer: OnlineRecognizer,
    source: Source,
    emit: (event: AsrEvent) => void,
    now: () => number = () => performance.now(),
    vad: VoiceDetector | null = null,
    hangoverMs = 0
  ) {
    this.vad = vad
    this.hangoverMs = hangoverMs
    this.recognizer = recognizer
    this.source = source
    this.emit = emit
    this.now = now
    this.stream = recognizer.createStream()
  }

  accept(samples: Float32Array): void {
    this.stream.acceptWaveform({ sampleRate: SAMPLE_RATE, samples })
    this.audioMs += (samples.length / SAMPLE_RATE) * 1000
    while (this.recognizer.isReady(this.stream)) this.recognizer.decode(this.stream)
    const text = this.recognizer.getResult(this.stream).text.trim()
    if (text !== this.lastText) {
      this.lastText = text
      this.lastChangeAtMs = this.audioMs
      if (text.length > 0) this.emit({ kind: 'partial', source: this.source, text })
    }
    // End of speech: the voice detector (fast, ~400 ms hangover) or, as a fallback, the recogniser's own endpoint.
    if (this.vad !== null) {
      this.vad.acceptWaveform(samples)
      while (!this.vad.isEmpty()) this.vad.pop()
      const speaking = this.vad.isDetected()
      if (speaking) {
        this.heardSpeech = true
        this.lastVoiceAtMs = this.audioMs
      }
      if (this.heardSpeech && !speaking && this.lastText.length > 0) {
        this.finish()
        return
      }
    }
    if (this.recognizer.isEndpoint(this.stream)) {
      this.finish()
      return
    }
    // Long silence: start a fresh stream so features never pile up over a 2-hour call.
    if (this.vad !== null && !this.heardSpeech && this.lastText.length === 0 && this.audioMs - this.streamStartMs > IDLE_RECYCLE_MS) {
      this.stream = this.recognizer.createStream()
      this.streamStartMs = this.audioMs
    }
  }

  /** Ends the current utterance now (endpoint, mute, device change). */
  finish(): void {
    const started = this.now()
    const pad = new Float32Array((SAMPLE_RATE * PAD_MS) / 1000)
    this.stream.acceptWaveform({ sampleRate: SAMPLE_RATE, samples: pad })
    this.stream.inputFinished()
    while (this.recognizer.isReady(this.stream)) this.recognizer.decode(this.stream)
    const text = this.recognizer.getResult(this.stream).text.trim()
    const computeMs = this.now() - started
    if (text.length > 0) {
      this.emit({
        kind: 'final',
        source: this.source,
        text,
        // With a voice detector: time since the voice stopped (its last "speech" report minus the hangover).
        // Without one: time since the text last changed.
        latencyMs:
          Math.max(0, this.vad !== null && this.heardSpeech ? this.audioMs - this.lastVoiceAtMs + this.hangoverMs : this.audioMs - this.lastChangeAtMs) +
          computeMs
      })
    }
    this.stream = this.recognizer.createStream()
    this.streamStartMs = this.audioMs
    this.heardSpeech = false
    this.lastText = ''
    this.lastChangeAtMs = this.audioMs
  }
}
