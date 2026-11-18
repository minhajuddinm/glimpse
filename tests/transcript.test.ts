import { describe, expect, it } from 'vitest'
import { CircuitBreaker, backoffDelay } from '../src/shared/backoff'
import { TranscriptBuffer, estimateTokens, jaccard, words } from '../src/main/transcript/buffer'

function clock(start = 1_000_000) {
  let t = start
  return { now: () => t, advance: (ms: number) => (t += ms) }
}

describe('TranscriptBuffer', () => {
  it('keeps labelled finals in order and clears the speaker partial', () => {
    const c = clock()
    const buffer = new TranscriptBuffer(2500, c.now)
    buffer.setPartial('them', 'tell me about')
    buffer.addFinal('them', 'Tell me about yourself.', 480)
    c.advance(3000)
    buffer.addFinal('you', 'I build developer tools', 510)
    const snap = buffer.snapshot()
    expect(snap.segments.map((s) => `${s.source}:${s.text}`)).toEqual(['them:Tell me about yourself.', 'you:I build developer tools'])
    expect(snap.partials).toEqual({ them: '', you: '' })
    expect(snap.segments[1]?.id).toBeGreaterThan(snap.segments[0]?.id ?? 0)
  })

  it('drops a microphone line that echoes what the other side just said', () => {
    const c = clock()
    const buffer = new TranscriptBuffer(2500, c.now)
    buffer.addFinal('them', 'What is the difference between a process and a thread', 500)
    c.advance(800)
    expect(buffer.addFinal('you', 'the difference between a process and a thread', 500)).toBeNull()
    expect(buffer.setPartial('you', 'difference between a process and a thread')).toBe(false)
    expect(buffer.snapshot().segments).toHaveLength(1)
  })

  it('keeps genuine replies, short ones and old repeats', () => {
    const c = clock()
    const buffer = new TranscriptBuffer(2500, c.now)
    buffer.addFinal('them', 'What is the difference between a process and a thread', 500)
    c.advance(500)
    expect(buffer.addFinal('you', 'A process has its own memory, threads share it', 500)).not.toBeNull()
    expect(buffer.addFinal('you', 'yes', 500)).not.toBeNull()
    c.advance(10_000)
    expect(buffer.addFinal('you', 'the difference between a process and a thread', 500)).not.toBeNull()
  })

  it('treats a match against the other side\x27s live partial as echo too', () => {
    const c = clock()
    const buffer = new TranscriptBuffer(2500, c.now)
    buffer.setPartial('them', 'how would you design a rate limiter')
    expect(buffer.addFinal('you', 'how would you design a rate limiter', 400)).toBeNull()
  })

  it('stays within the token budget by dropping the oldest segments', () => {
    const buffer = new TranscriptBuffer(100, clock().now)
    for (let i = 0; i < 200; i++) {
      if (i % 2 === 0) buffer.addFinal('them', `question ${i} about distributed systems and caching`, 500)
      else buffer.addFinal('you', `answer ${i} mentions my internship project work`, 500)
    }
    expect(buffer.tokenEstimate).toBeLessThanOrEqual(100)
    const segments = buffer.snapshot().segments
    expect(segments.at(-1)?.text).toContain('199')
    expect(segments.length).toBeLessThan(20)
  })

  it('ignores empty finals and reports latency percentiles', () => {
    const buffer = new TranscriptBuffer(2500, clock().now)
    expect(buffer.addFinal('them', '   ', 300)).toBeNull()
    expect(buffer.latencyStats()).toEqual({ p50: null, p95: null, samples: 0 })
    for (const ms of [400, 450, 500, 550, 600, 650, 700, 750, 800, 1000]) buffer.addFinal('them', `line ${ms}`, ms)
    expect(buffer.latencyStats()).toEqual({ p50: 600, p95: 1000, samples: 10 })
  })
})

describe('text helpers', () => {
  it('tokenises, compares and estimates', () => {
    expect(words("It's 5 PM, OK?")).toEqual(["it's", '5', 'pm', 'ok'])
    expect(jaccard(['a', 'b'], ['b', 'c'])).toBeCloseTo(1 / 3)
    expect(jaccard([], [])).toBe(0)
    expect(estimateTokens('one two three four five six seven eight nine ten')).toBe(13)
  })
})

describe('backoff and circuit breaker', () => {
  it('grows exponentially with jitter and caps', () => {
    expect(backoffDelay(0, () => 1)).toBe(500)
    expect(backoffDelay(3, () => 1)).toBe(4000)
    expect(backoffDelay(3, () => 0)).toBe(2000)
    expect(backoffDelay(20, () => 1)).toBe(15_000)
  })

  it('opens after five consecutive failures and closes on success', () => {
    const breaker = new CircuitBreaker()
    for (let i = 0; i < 4; i++) breaker.recordFailure()
    expect(breaker.open).toBe(false)
    breaker.recordFailure()
    expect(breaker.open).toBe(true)
    breaker.recordSuccess()
    expect(breaker.open).toBe(false)
    expect(breaker.consecutiveFailures).toBe(0)
  })
})
