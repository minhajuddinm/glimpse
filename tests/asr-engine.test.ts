import { describe, expect, it } from 'vitest'
import { PAD_MS, SAMPLE_RATE, SourceRecognizer, type AsrEvent } from '../src/main/asr/engine'
import type { OnlineRecognizer, OnlineResult, OnlineStream, WaveInput } from '../src/main/asr/sherpa-types'

/**
 * A scripted recogniser: each chunk of non-zero audio "speaks" the next word,
 * silence produces nothing, and an endpoint fires after 5 silent chunks.
 */
class FakeStream implements OnlineStream {
  words: string[] = []
  silentChunks = 0
  finished = false
  padded = 0
  constructor(private readonly script: string[]) {}
  acceptWaveform(input: WaveInput): void {
    if (this.finished) throw new Error('accept after inputFinished')
    const loud = input.samples.some((sample) => sample !== 0)
    if (loud) {
      const word = this.script[this.words.length]
      if (word !== undefined) this.words.push(word)
      this.silentChunks = 0
    } else {
      this.silentChunks++
      this.padded += input.samples.length
    }
  }
  inputFinished(): void {
    this.finished = true
  }
}

class FakeRecognizer implements OnlineRecognizer {
  readonly streams: FakeStream[] = []
  fake(stream: OnlineStream): FakeStream {
    const found = this.streams.find((candidate) => candidate === stream)
    if (found === undefined) throw new Error('unknown stream')
    return found
  }
  constructor(private readonly script: string[]) {}
  createStream(): OnlineStream {
    const stream = new FakeStream(this.script)
    this.streams.push(stream)
    return stream
  }
  isReady(): boolean {
    return false
  }
  decode(): void {
    // Decoding is immediate in the fake.
  }
  getResult(stream: OnlineStream): OnlineResult {
    return { text: this.fake(stream).words.join(' '), tokens: [], timestamps: [] }
  }
  isEndpoint(stream: OnlineStream): boolean {
    const fake = this.fake(stream)
    return fake.words.length > 0 && fake.silentChunks >= 5
  }
  reset(): void {
    // Not used: a new stream is created per utterance.
  }
}

const CHUNK = SAMPLE_RATE / 10
const loud = (): Float32Array => new Float32Array(CHUNK).fill(0.2)
const quiet = (): Float32Array => new Float32Array(CHUNK)

describe('SourceRecognizer', () => {
  it('emits growing partials, then one final at the endpoint, then starts a new utterance', () => {
    const recognizer = new FakeRecognizer(['tell', 'me', 'about', 'yourself'])
    const events: AsrEvent[] = []
    const source = new SourceRecognizer(recognizer, 'them', (event) => events.push(event), () => 0)

    for (let i = 0; i < 4; i++) source.accept(loud())
    for (let i = 0; i < 5; i++) source.accept(quiet())

    expect(events.filter((e) => e.kind === 'partial').map((e) => e.text)).toEqual([
      'tell',
      'tell me',
      'tell me about',
      'tell me about yourself'
    ])
    const finals = events.filter((e) => e.kind === 'final')
    expect(finals).toHaveLength(1)
    expect(finals[0]).toMatchObject({ source: 'them', text: 'tell me about yourself' })
    // The first stream got PAD_MS of instant padding on top of the 5 silent chunks, then was finished.
    const first = recognizer.streams[0]
    expect(first?.finished).toBe(true)
    expect(first?.padded).toBe(5 * CHUNK + (SAMPLE_RATE * PAD_MS) / 1000)
    expect(recognizer.streams).toHaveLength(2)
  })

  it('reports latency from the last text change to the endpoint', () => {
    const recognizer = new FakeRecognizer(['hello'])
    const events: AsrEvent[] = []
    const source = new SourceRecognizer(recognizer, 'you', (event) => events.push(event), () => 0)
    source.accept(loud())
    for (let i = 0; i < 5; i++) source.accept(quiet())
    const final = events.find((e) => e.kind === 'final')
    expect(final?.kind === 'final' ? final.latencyMs : -1).toBe(500)
  })

  it('finish() with nothing said emits no final but still starts a fresh stream', () => {
    const recognizer = new FakeRecognizer(['x'])
    const events: AsrEvent[] = []
    const source = new SourceRecognizer(recognizer, 'them', (event) => events.push(event), () => 0)
    source.accept(quiet())
    source.finish()
    expect(events).toEqual([])
    expect(recognizer.streams).toHaveLength(2)
  })
})

/** Says "speech" for loud chunks and keeps saying it for `hangover` quiet chunks afterwards. */
class FakeVad {
  private quietRun = 99
  constructor(private readonly hangover: number) {}
  acceptWaveform(samples: Float32Array): void {
    this.quietRun = samples.some((sample) => sample !== 0) ? 0 : this.quietRun + 1
  }
  isDetected(): boolean {
    return this.quietRun <= this.hangover
  }
  isEmpty(): boolean {
    return true
  }
  pop(): void {
    // Segments are not used.
  }
}

describe('SourceRecognizer with a voice detector', () => {
  it('ends the utterance when the voice stops, measuring latency from the last voiced audio', () => {
    // The fake recogniser's own endpoint needs 5 quiet chunks; the voice detector ends it after 4.
    const recognizer = new FakeRecognizer(['tell', 'me'])
    const events: AsrEvent[] = []
    const source = new SourceRecognizer(recognizer, 'them', (event) => events.push(event), () => 0, new FakeVad(3), 300)
    source.accept(loud())
    source.accept(loud())
    for (let i = 0; i < 4; i++) source.accept(quiet())
    const final = events.find((event) => event.kind === 'final')
    expect(final?.text).toBe('tell me')
    // Voice stopped after the 2nd chunk; the detector held "speech" for its 300 ms hangover; final on the 4th quiet chunk.
    expect(final?.kind === 'final' ? final.latencyMs : -1).toBe(400)
  })

  it('does not end a sentence that starts after a long silence', () => {
    // Regression: a "nothing heard for N s" rule used to fire as the next sentence began.
    const recognizer = new FakeRecognizer(['what', 'is', 'the', 'difference'])
    const events: AsrEvent[] = []
    const source = new SourceRecognizer(recognizer, 'them', (event) => events.push(event), () => 0, new FakeVad(3))
    for (let i = 0; i < 40; i++) source.accept(quiet())
    for (let i = 0; i < 4; i++) source.accept(loud())
    expect(events.filter((event) => event.kind === 'final')).toEqual([])
    for (let i = 0; i < 4; i++) source.accept(quiet())
    expect(events.filter((event) => event.kind === 'final').map((event) => event.text)).toEqual(['what is the difference'])
  })

  it('replaces an idle stream after 10 s of silence so memory stays flat', () => {
    const recognizer = new FakeRecognizer(['x'])
    const source = new SourceRecognizer(recognizer, 'them', () => undefined, () => 0, new FakeVad(3))
    for (let i = 0; i < 99; i++) source.accept(quiet())
    expect(recognizer.streams).toHaveLength(1)
    for (let i = 0; i < 3; i++) source.accept(quiet())
    expect(recognizer.streams).toHaveLength(2)
  })
})
