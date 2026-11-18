import type { Segment, Source, TranscriptSnapshot } from '../../shared/transcript'

/** Rough LLM-token estimate: English averages about 1.3 tokens per word. */
export function estimateTokens(text: string): number {
  return Math.ceil(words(text).length * 1.3)
}

export function words(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9' ]+/g, ' ')
    .split(/\s+/)
    .filter((word) => word.length > 0)
}

export function jaccard(a: readonly string[], b: readonly string[]): number {
  const setA = new Set(a)
  const setB = new Set(b)
  if (setA.size === 0 && setB.size === 0) return 0
  let shared = 0
  for (const word of setA) if (setB.has(word)) shared++
  return shared / (setA.size + setB.size - shared)
}

export const ECHO_WINDOW_MS = 4000
export const ECHO_SIMILARITY = 0.6

/**
 * Rolling, speaker-labelled transcript. Memory stays flat: the oldest finished
 * segments are dropped once the estimated size passes `maxTokens`.
 *
 * Echo guard: if speakers play the other side's voice and the microphone picks
 * it up, a "you" line repeats a recent "them" line. Such lines are dropped.
 */
export class TranscriptBuffer {
  private segments: Segment[] = []
  private partials: Record<Source, string> = { them: '', you: '' }
  private nextId = 1
  private tokens = 0
  private readonly latencies: number[] = []

  constructor(
    private readonly maxTokens = 2500,
    private readonly now: () => number = () => Date.now()
  ) {}

  /** True if `text` from the microphone repeats what the other side said moments ago. */
  isEcho(text: string): boolean {
    const mine = words(text)
    if (mine.length < 3) return false
    const since = this.now() - ECHO_WINDOW_MS
    const theirs = [
      ...this.segments.filter((segment) => segment.source === 'them' && segment.at >= since).map((segment) => segment.text),
      this.partials.them
    ]
    return theirs.some((other) => jaccard(mine, words(other)) >= ECHO_SIMILARITY)
  }

  /** Returns false if the partial was suppressed as echo. */
  setPartial(source: Source, text: string): boolean {
    if (source === 'you' && this.isEcho(text)) {
      this.partials.you = ''
      return false
    }
    this.partials[source] = text
    return true
  }

  /** Adds a finished utterance, or returns null if it was empty or an echo. */
  addFinal(source: Source, text: string, latencyMs: number | null): Segment | null {
    this.partials[source] = ''
    const trimmed = text.trim()
    if (trimmed.length === 0) return null
    if (source === 'you' && this.isEcho(trimmed)) return null
    const segment: Segment = { id: this.nextId++, source, text: trimmed, at: this.now(), latencyMs }
    this.segments.push(segment)
    this.tokens += estimateTokens(trimmed)
    while (this.tokens > this.maxTokens && this.segments.length > 1) {
      const dropped = this.segments.shift()
      if (dropped !== undefined) this.tokens -= estimateTokens(dropped.text)
    }
    if (latencyMs !== null) {
      this.latencies.push(latencyMs)
      if (this.latencies.length > 100) this.latencies.shift()
    }
    return segment
  }

  snapshot(): TranscriptSnapshot {
    return { segments: [...this.segments], partials: { ...this.partials } }
  }

  /** p50/p95 of the last 100 speech-end → text latencies. */
  latencyStats(): { p50: number | null; p95: number | null; samples: number } {
    if (this.latencies.length === 0) return { p50: null, p95: null, samples: 0 }
    const sorted = [...this.latencies].sort((a, b) => a - b)
    const at = (p: number): number => sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)] ?? 0
    return { p50: Math.round(at(50)), p95: Math.round(at(95)), samples: sorted.length }
  }

  get tokenEstimate(): number {
    return this.tokens
  }

  clear(): void {
    this.segments = []
    this.partials = { them: '', you: '' }
    this.tokens = 0
  }
}
