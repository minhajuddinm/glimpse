import type { AnswerKind } from '../../shared/answers'
import { isCheckableClaim, jaccardText, questionScore } from './triggers'

export interface SchedulerConfig {
  readonly threshold: number
  /** After an answer completes, automatic answers wait this long (C2). */
  readonly cooldownMs: number
  /** At most one automatic answer per this interval (C2). */
  readonly autoMinGapMs: number
  /** A question this similar (word Jaccard) to one of the last 3 answered is a duplicate. */
  readonly duplicateSimilarity: number
  /** Talking points after this long without an answer while the other side keeps talking. */
  readonly talkingPointsAfterMs: number
  readonly talkingPointsMinWords: number
}

export const DEFAULT_SCHEDULER_CONFIG: SchedulerConfig = {
  threshold: 0.6,
  cooldownMs: 4000,
  autoMinGapMs: 15_000,
  duplicateSimilarity: 0.65,
  talkingPointsAfterMs: 20_000,
  talkingPointsMinWords: 40
}

export type Decision =
  | { readonly action: 'start'; readonly kind: AnswerKind; readonly question: string; readonly score: number; readonly replaces: number | null }
  | { readonly action: 'skip'; readonly reason: 'not-a-trigger' | 'duplicate' | 'busy' | 'cooldown' | 'rate-limit' | 'disabled' }

interface InFlight {
  readonly id: number
  readonly score: number
}

/**
 * Decides when to answer (C2): one generation at a time, a stronger trigger
 * replaces the one in flight, a cooldown after each answer, at most one automatic
 * answer per 15 s, and repeats of recent questions are suppressed. Manual requests
 * bypass every limit except the one-at-a-time rule (they replace).
 */
export class AnswerScheduler {
  private inFlight: InFlight | null = null
  private lastStartedAt = -Infinity
  private lastCompletedAt = -Infinity
  private lastAnswerAt = -Infinity
  private readonly recentQuestions: string[] = []
  private wordsSinceAnswer = 0
  private quietSince: number

  constructor(
    private readonly now: () => number,
    private readonly config: SchedulerConfig = DEFAULT_SCHEDULER_CONFIG
  ) {
    this.quietSince = now()
  }

  get busy(): boolean {
    return this.inFlight !== null
  }

  /** A finished line from the other side of the call. */
  onTheirLine(text: string, options: { auto: boolean; factCheck: boolean }): Decision {
    const now = this.now()
    const score = questionScore(text)
    this.wordsSinceAnswer += text.split(/\s+/).filter((word) => word.length > 0).length
    if (!options.auto) return { action: 'skip', reason: 'disabled' }

    let kind: AnswerKind | null = null
    if (score >= this.config.threshold) kind = 'answer'
    else if (options.factCheck && isCheckableClaim(text)) kind = 'fact-check'
    else if (
      now - Math.max(this.lastAnswerAt, this.quietSince) >= this.config.talkingPointsAfterMs &&
      this.wordsSinceAnswer >= this.config.talkingPointsMinWords
    ) {
      kind = 'talking-points'
    }
    if (kind === null) return { action: 'skip', reason: 'not-a-trigger' }

    if (kind !== 'talking-points' && this.isDuplicate(text)) return { action: 'skip', reason: 'duplicate' }
    const effective = kind === 'answer' ? score : kind === 'fact-check' ? 0.5 : 0.4
    if (this.inFlight !== null) {
      if (effective > this.inFlight.score) return { action: 'start', kind, question: text, score: effective, replaces: this.inFlight.id }
      return { action: 'skip', reason: 'busy' }
    }
    if (now - this.lastCompletedAt < this.config.cooldownMs) return { action: 'skip', reason: 'cooldown' }
    if (now - this.lastStartedAt < this.config.autoMinGapMs) return { action: 'skip', reason: 'rate-limit' }
    return { action: 'start', kind, question: text, score: effective, replaces: null }
  }

  /** The "answer now" / "elaborate" hotkeys or the Ask box: always runs, replacing anything in flight. */
  manual(kind: AnswerKind, question: string): Extract<Decision, { action: 'start' }> {
    return { action: 'start', kind, question, score: 2, replaces: this.inFlight?.id ?? null }
  }

  started(id: number, decision: Extract<Decision, { action: 'start' }>): void {
    this.inFlight = { id, score: decision.score }
    this.lastStartedAt = this.now()
    if (decision.kind !== 'talking-points') {
      this.recentQuestions.push(decision.question)
      if (this.recentQuestions.length > 3) this.recentQuestions.shift()
    }
  }

  finished(id: number): void {
    if (this.inFlight?.id !== id) return
    this.inFlight = null
    this.lastCompletedAt = this.now()
    this.lastAnswerAt = this.lastCompletedAt
    this.wordsSinceAnswer = 0
  }

  /** A cancelled or failed answer frees the slot without starting the cooldown. */
  abandoned(id: number): void {
    if (this.inFlight?.id === id) this.inFlight = null
  }

  reset(): void {
    this.inFlight = null
    this.recentQuestions.length = 0
    this.lastStartedAt = -Infinity
    this.lastCompletedAt = -Infinity
    this.lastAnswerAt = -Infinity
    this.wordsSinceAnswer = 0
    this.quietSince = this.now()
  }

  private isDuplicate(text: string): boolean {
    return this.recentQuestions.some((previous) => jaccardText(previous, text) > this.config.duplicateSimilarity)
  }
}
