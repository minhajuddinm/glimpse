import { describe, expect, it } from 'vitest'
import type { AnswersSnapshot, KbHit } from '../src/shared/answers'
import { DEFAULT_SETTINGS, type Settings } from '../src/shared/settings'
import type { Segment, TranscriptSnapshot } from '../src/shared/transcript'
import type { LlmCall, LlmProvider } from '../src/main/answers/llm'
import { AnswerScheduler } from '../src/main/answers/scheduler'
import { AnswerService } from '../src/main/answers/service'

/** A model that streams a scripted reply word by word; it can hang until aborted. */
class FakeProvider implements LlmProvider {
  readonly id = 'anthropic' as const
  readonly calls: LlmCall[] = []
  constructor(private readonly replies: string[], private readonly hang = false) {}
  model(deep: boolean): string {
    return deep ? 'deep-model' : 'fast-model'
  }
  async stream(call: LlmCall, onText: (delta: string) => void, signal: AbortSignal): Promise<string> {
    this.calls.push(call)
    if (this.hang) {
      await new Promise((_, reject) => {
        signal.addEventListener('abort', () => {
          reject(new DOMException('aborted', 'AbortError'))
        })
      })
    }
    const reply = this.replies[Math.min(this.calls.length - 1, this.replies.length - 1)] ?? ''
    for (const word of reply.split(/(?<= )/)) {
      if (signal.aborted) throw new DOMException('aborted', 'AbortError')
      onText(word)
      await Promise.resolve()
    }
    return reply
  }
}

const PREPARED: KbHit = { file: 'interview.md', kind: 'qa', question: 'Tell me about yourself', text: 'I build developer tools; I interned at Shopify.', score: 1, similarity: 0.9 }

function setup(options: { provider: LlmProvider | null; hits?: KbHit[]; settings?: Partial<Settings> }) {
  let t = 1_000_000
  const now = (): number => t
  const transcript: TranscriptSnapshot = { segments: [], partials: { them: '', you: '' } }
  const emitted: AnswersSnapshot[] = []
  const service = new AnswerService({
    scheduler: new AnswerScheduler(now),
    search: () => Promise.resolve(options.hits ?? []),
    provider: () => options.provider,
    settings: () => ({ ...DEFAULT_SETTINGS, ...options.settings }),
    context: () => '',
    transcript: () => transcript,
    emit: (snapshot) => emitted.push(snapshot),
    now,
    throttleMs: 0
  })
  let id = 1
  const say = (text: string, source: 'them' | 'you' = 'them'): Segment => {
    t += 3000
    const segment: Segment = { id: id++, source, text, at: t, latencyMs: 500 }
    transcript.segments.push(segment)
    service.onSegment(segment)
    return segment
  }
  return { service, emitted, say, advance: (ms: number) => (t += ms) }
}

const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 20))

describe('AnswerService', () => {
  it('answers a question from the other side with a streamed, contract-clean model answer', async () => {
    const provider = new FakeProvider(['A process has its own memory; threads share it. '])
    const { service, say } = setup({ provider })
    say('What is the difference between a process and a thread')
    await settle()
    const [answer] = service.snapshot().answers
    expect(answer).toMatchObject({ kind: 'answer', status: 'done', origin: 'model', model: 'fast-model', text: 'A process has its own memory; threads share it.' })
    expect(answer?.firstTextAt).not.toBeNull()
    // The question ended 500 ms (the latency) before the line was finalised.
    expect(answer?.askedAt).toBe(1_003_000 - 500)
    expect(provider.calls[0]?.user).toContain('>>> Them: What is the difference between a process and a thread')
  })

  it('ignores your own lines and statements that are not questions', async () => {
    const provider = new FakeProvider(['x'])
    const { service, say } = setup({ provider })
    say('Tell me about yourself', 'you')
    say('We use Postgres in production')
    await settle()
    expect(service.snapshot().answers).toEqual([])
  })

  it('shows a matching prepared answer from the notes instantly, then refines it with the model', async () => {
    const provider = new FakeProvider(['I build developer tools and interned at Shopify on payments. '])
    const { service, emitted, say } = setup({ provider, hits: [PREPARED] })
    say('Could you introduce yourself')
    await settle()
    const firstWithText = emitted.flatMap((s) => s.answers).find((a) => a.text !== '')
    expect(firstWithText).toMatchObject({ origin: 'notes', text: PREPARED.text, sources: ['interview.md'] })
    expect(service.snapshot().answers[0]).toMatchObject({ status: 'done', origin: 'notes+model' })
    expect(provider.calls[0]?.user).toContain('kind="prepared answer"')
  })

  it('without an API key, still gives the prepared answer, or explains what to add', async () => {
    const withNotes = setup({ provider: null, hits: [PREPARED] })
    withNotes.say('Tell me about yourself')
    await settle()
    expect(withNotes.service.snapshot().answers[0]).toMatchObject({ status: 'done', origin: 'notes', text: PREPARED.text })

    const without = setup({ provider: null })
    without.say('Explain the CAP theorem')
    await settle()
    expect(without.service.snapshot().answers[0]).toMatchObject({ status: 'error' })
    expect(without.service.snapshot().answers[0]?.error).toContain('API key')
  })

  it('retries once when the model breaks the output rules', async () => {
    const provider = new FakeProvider(['Sure! ## Heading\nAnswer one. ', 'A clean answer. '])
    const { service, say } = setup({ provider })
    say('Explain the CAP theorem in simple terms')
    await settle()
    expect(provider.calls).toHaveLength(2)
    expect(provider.calls[1]?.user).toContain('broke the output rules')
    expect(service.snapshot().answers[0]?.text).toBe('A clean answer.')
  })

  it('a manual request cancels the answer in flight mid-stream', async () => {
    const provider = new FakeProvider([''], true)
    const { service, say } = setup({ provider })
    say('What is a hash map')
    await settle()
    const asking = service.ask('How do you handle conflict')
    await settle()
    const [newest, older] = service.snapshot().answers
    expect(older).toMatchObject({ question: 'What is a hash map', status: 'cancelled' })
    expect(newest).toMatchObject({ question: 'How do you handle conflict', status: 'thinking' })
    service.clear()
    await asking
    expect(service.snapshot().answers).toEqual([])
  })

  it('suppresses the same question asked twice within 10 s (G8)', async () => {
    const provider = new FakeProvider(['An answer. '])
    const { service, say } = setup({ provider })
    say('Tell me about yourself')
    await settle()
    say('tell me about yourself')
    await settle()
    expect(service.snapshot().answers).toHaveLength(1)
  })

  it('elaborate uses the deep model on the last question', async () => {
    const provider = new FakeProvider(['Short. ', 'A longer answer with an example. '])
    const { service, say } = setup({ provider })
    say('What is a hash map')
    await settle()
    await service.elaborate()
    expect(provider.calls[1]?.deep).toBe(true)
    expect(service.snapshot().answers[0]).toMatchObject({ kind: 'elaborate', model: 'deep-model', question: 'What is a hash map' })
  })

  it('a model error is shown with its reason, keeping a prepared answer if there was one', async () => {
    const failing: LlmProvider = { id: 'groq', model: () => 'm', stream: () => Promise.reject(new Error('Groq error 401')) }
    const plain = setup({ provider: failing })
    plain.say('Explain the CAP theorem')
    await settle()
    expect(plain.service.snapshot().answers[0]).toMatchObject({ status: 'error', error: 'Groq error 401' })
    const withNotes = setup({ provider: failing, hits: [PREPARED] })
    withNotes.say('Tell me about yourself')
    await settle()
    expect(withNotes.service.snapshot().answers[0]).toMatchObject({ status: 'done', origin: 'notes' })
  })
})
