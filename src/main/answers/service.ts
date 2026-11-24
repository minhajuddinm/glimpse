import type { Answer, AnswerKind, AnswersSnapshot, KbHit } from '../../shared/answers'
import type { Settings } from '../../shared/settings'
import type { Segment, TranscriptSnapshot } from '../../shared/transcript'
import { instantAnswer } from '../kb/store'
import { enforceContract, needsRetry, type Violation } from './contract'
import type { LlmProvider } from './llm'
import { buildPrompt } from './prompt'
import type { AnswerScheduler, Decision } from './scheduler'

export interface AnswerServiceDeps {
  readonly scheduler: AnswerScheduler
  readonly search: (query: string) => Promise<KbHit[]>
  readonly provider: () => LlmProvider | null
  readonly settings: () => Settings
  readonly context: () => string
  readonly transcript: () => TranscriptSnapshot
  readonly emit: (snapshot: AnswersSnapshot) => void
  readonly now: () => number
  /** Minimum gap between streamed UI updates. */
  readonly throttleMs?: number
}

const KEEP = 12
const NO_PROVIDER = 'Add an Anthropic or Groq API key in Settings → Answers to generate answers.'

/**
 * For each trigger: retrieve relevant facts from the notes, then stream an answer
 * written for the exact question. Saved answers are only an explicit offline fallback;
 * enforce the output contract (one retry), and keep the newest answers for the UI.
 */
export class AnswerService {
  private answers: Answer[] = []
  private nextId = 1
  private readonly controllers = new Map<number, AbortController>()
  private lastEmit = 0
  private emitTimer: ReturnType<typeof setTimeout> | null = null

  constructor(private readonly deps: AnswerServiceDeps) {}

  snapshot(): AnswersSnapshot {
    return { answers: [...this.answers] }
  }

  /** Every finished transcript line goes through here; only the other side's lines can trigger. */
  onSegment(segment: Segment): void {
    if (segment.source !== 'them') return
    const settings = this.deps.settings()
    const decision = this.deps.scheduler.onTheirLine(segment.text, { auto: settings.autoAnswer, factCheck: settings.factCheck })
    // The question ended when the voice stopped, which is `latencyMs` before the line was finalised.
    if (decision.action === 'start') void this.run(decision, segment.at - (segment.latencyMs ?? 0))
  }

  /** "Answer now" hotkey and the Ask box. Without a question, answers the latest line from the other side. */
  ask(question?: string, kind: AnswerKind = 'answer', imageJpeg?: string): Promise<void> {
    const text = question?.trim() ?? ''
    const latest = [...this.deps.transcript().segments].reverse().find((segment) => segment.source === 'them')?.text ?? ''
    const target = text !== '' ? text : latest
    if (target === '' && imageJpeg === undefined) return Promise.resolve()
    return this.run(this.deps.scheduler.manual(kind, target), this.deps.now(), imageJpeg)
  }

  /** A fuller answer to the most recent question. */
  elaborate(): Promise<void> {
    const last = this.answers.find((answer) => answer.kind !== 'talking-points')
    return this.ask(last?.question, 'elaborate')
  }

  regenerate(): Promise<void> {
    const last = this.answers[0]
    if (last === undefined) return this.ask()
    return this.ask(last.question, last.kind === 'elaborate' ? 'elaborate' : last.kind === 'screen' ? 'answer' : last.kind)
  }

  retry(id: number): Promise<void> {
    const answer = this.answers.find((candidate) => candidate.id === id)
    if (answer === undefined) return Promise.resolve()
    return this.ask(answer.question, answer.kind === 'screen' ? 'answer' : answer.kind)
  }

  clear(): void {
    for (const controller of this.controllers.values()) controller.abort()
    this.controllers.clear()
    this.answers = []
    this.deps.scheduler.reset()
    this.flush()
  }

  private update(id: number, patch: Partial<Answer>, immediate = false): void {
    this.answers = this.answers.map((answer) => (answer.id === id ? { ...answer, ...patch } : answer))
    if (immediate) this.flush()
    else this.schedule()
  }

  private schedule(): void {
    const wait = (this.deps.throttleMs ?? 60) - (this.deps.now() - this.lastEmit)
    if (wait <= 0) {
      this.flush()
      return
    }
    this.emitTimer ??= setTimeout(() => {
      this.emitTimer = null
      this.flush()
    }, wait)
  }

  private flush(): void {
    if (this.emitTimer !== null) clearTimeout(this.emitTimer)
    this.emitTimer = null
    this.lastEmit = this.deps.now()
    this.deps.emit(this.snapshot())
  }

  private async run(decision: Extract<Decision, { action: 'start' }>, askedAt: number, imageJpeg?: string): Promise<void> {
    if (decision.replaces !== null) {
      this.controllers.get(decision.replaces)?.abort()
      this.controllers.delete(decision.replaces)
      this.deps.scheduler.abandoned(decision.replaces)
      this.update(decision.replaces, { status: 'cancelled' })
    }
    const id = this.nextId++
    const kind = imageJpeg !== undefined ? 'screen' : decision.kind
    const controller = new AbortController()
    this.controllers.set(id, controller)
    this.deps.scheduler.started(id, decision)
    const fresh: Answer = {
      id,
      kind,
      question: decision.question,
      text: '',
      status: 'thinking',
      origin: 'none',
      sources: [],
      error: null,
      askedAt,
      firstTextAt: null,
      doneAt: null,
      model: null
    }
    this.answers = [fresh, ...this.answers].slice(0, KEEP)
    this.flush()

    try {
      const query = kind === 'talking-points' ? this.recentTheirText() : decision.question
      const hits = query.trim() === '' ? [] : await this.deps.search(query)
      if (controller.signal.aborted) return
      const sources = [...new Set(hits.map((hit) => hit.file))]
      const provider = this.deps.provider()
      if (provider === null) {
        const offline = kind === 'answer' ? instantAnswer(hits) : null
        if (offline !== null) {
          const text = enforceContract(offline.text, kind).text
          this.update(id, {
            text, origin: 'notes', sources: [offline.file], status: 'done',
            firstTextAt: this.deps.now(), doneAt: this.deps.now(),
            error: 'Saved note only. Add an API key in Settings → Answers for a tailored answer.'
          }, true)
        } else this.update(id, { status: 'error', error: NO_PROVIDER, sources }, true)
        this.finish(id, offline !== null)
        return
      }

      const settings = this.deps.settings()
      let correction: string | undefined
      for (let attempt = 0; attempt < 2; attempt++) {
        const prompt = buildPrompt({
          mode: settings.mode,
          kind,
          context: this.deps.context(),
          transcript: this.deps.transcript(),
          trigger: decision.question,
          notes: hits,
          ...(correction === undefined ? {} : { correction })
        })
        let raw = ''
        const full = await provider.stream(
          { system: prompt.system, user: prompt.user, maxTokens: prompt.maxTokens, deep: kind === 'elaborate', ...(imageJpeg === undefined ? {} : { imageJpeg }) },
          (delta) => {
            if (controller.signal.aborted) return
            raw += delta
            const live = enforceContract(raw, kind).text
            if (live.length === 0) return
            const current = this.answers.find((answer) => answer.id === id)
            this.update(id, {
              text: live,
              status: 'streaming',
              origin: hits.length > 0 ? 'notes+model' : 'model',
              sources,
              model: provider.model(kind === 'elaborate'),
              firstTextAt: current?.firstTextAt ?? this.deps.now()
            }, current?.firstTextAt === null)
          },
          controller.signal
        )
        if (this.controllers.get(id) !== controller) return
        const result = enforceContract(full, kind)
        if (attempt === 0 && needsRetry(result.violations)) {
          correction = describe(result.violations)
          continue
        }
        const firstTextAt = this.answers.find((answer) => answer.id === id)?.firstTextAt
        this.update(id, { origin: hits.length > 0 ? 'notes+model' : 'model', sources, model: provider.model(kind === 'elaborate'), firstTextAt: result.text === '' ? null : (firstTextAt ?? this.deps.now()), text: result.text, status: result.violations.includes('empty') ? 'error' : 'done', error: result.violations.includes('empty') ? 'The model returned nothing.' : null, doneAt: this.deps.now() }, true)
        break
      }
      this.finish(id, this.answers.find((answer) => answer.id === id)?.status === 'done')
    } catch (error) {
      if (controller.signal.aborted) return
      this.update(id, { status: 'error', error: error instanceof Error ? error.message : String(error) }, true)
      this.finish(id, false)
    }
  }

  private finish(id: number, completed: boolean): void {
    this.controllers.delete(id)
    if (completed) this.deps.scheduler.finished(id)
    else this.deps.scheduler.abandoned(id)
  }

  private recentTheirText(): string {
    return this.deps
      .transcript()
      .segments.filter((segment) => segment.source === 'them')
      .slice(-4)
      .map((segment) => segment.text)
      .join(' ')
  }
}

function describe(violations: readonly Violation[]): string {
  const names: Record<Violation, string> = { preamble: 'it opened with a preamble', heading: 'it used a heading', length: 'it was too long', empty: 'it was empty' }
  return violations.map((violation) => names[violation]).join(', ')
}
