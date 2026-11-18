import { describe, expect, it } from 'vitest'
import { enforceContract, needsRetry, truncateAtSentence } from '../src/main/answers/contract'
import { AnswerScheduler, type Decision } from '../src/main/answers/scheduler'
import { isCheckableClaim, jaccardText, questionScore } from '../src/main/answers/triggers'

describe('questionScore (C1)', () => {
  it.each([
    'Tell me about yourself',
    'what is the difference between a process and a thread',
    'Can you walk me through your most challenging project',
    'How would you design a rate limiter?',
    'Explain the CAP theorem in simple terms',
    'Give me an example of using React hooks',
    'Do you have any questions for us',
    'Why do you want to work here'
  ])('fires for "%s"', (text) => {
    expect(questionScore(text)).toBeGreaterThanOrEqual(0.6)
  })

  it.each([
    'We have a budget of forty five thousand dollars for the first quarter',
    'Our team uses Kubernetes and Postgres in production',
    'okay',
    'yes',
    'The meeting is scheduled for Thursday at two thirty',
    'Is'
  ])('does not fire for "%s"', (text) => {
    expect(questionScore(text)).toBeLessThan(0.6)
  })
})

describe('isCheckableClaim', () => {
  it('spots numbers, dates and names in statements', () => {
    expect(isCheckableClaim('Our revenue grew by twenty three percent last year')).toBe(true)
    expect(isCheckableClaim('Kubernetes was first released in 2014 by Google')).toBe(true)
    expect(isCheckableClaim('that sounds good to me thanks')).toBe(false)
    expect(isCheckableClaim('How many users do you have in 2025?')).toBe(false)
  })
})

describe('jaccardText', () => {
  it('compares word sets ignoring case and punctuation', () => {
    expect(jaccardText('Tell me about yourself.', 'tell me about yourself')).toBe(1)
    expect(jaccardText('tell me about yourself', 'what is a thread')).toBe(0)
  })
})

function clock() {
  let t = 1_000_000
  return { now: () => t, advance: (ms: number) => (t += ms) }
}
const AUTO = { auto: true, factCheck: false }
const start = (decision: Decision): Extract<Decision, { action: 'start' }> => {
  if (decision.action !== 'start') throw new Error(`expected start, got ${decision.reason}`)
  return decision
}

describe('AnswerScheduler (C2)', () => {
  it('answers a question and suppresses the same question again within 10 s (G8)', () => {
    const c = clock()
    const s = new AnswerScheduler(c.now)
    const first = start(s.onTheirLine('Tell me about yourself', AUTO))
    expect(first.kind).toBe('answer')
    s.started(1, first)
    c.advance(1500)
    s.finished(1)
    c.advance(8000)
    expect(s.onTheirLine('tell me about yourself', AUTO)).toEqual({ action: 'skip', reason: 'duplicate' })
  })

  it('keeps one answer in flight; a stronger trigger replaces it', () => {
    const c = clock()
    const s = new AnswerScheduler(c.now)
    const weak = start(s.onTheirLine('Is that something you have done', AUTO))
    s.started(1, weak)
    expect(s.onTheirLine('Are you sure about that', AUTO)).toMatchObject({ action: 'skip', reason: 'busy' })
    const strong = start(s.onTheirLine('Walk me through how you would design a rate limiter?', AUTO))
    expect(strong.replaces).toBe(1)
  })

  it('waits 4 s after an answer, and allows at most one automatic answer per 15 s', () => {
    const c = clock()
    const s = new AnswerScheduler(c.now)
    s.started(1, start(s.onTheirLine('What is a hash map', AUTO)))
    c.advance(1000)
    s.finished(1)
    c.advance(2000)
    expect(s.onTheirLine('How do you prioritize work', AUTO)).toMatchObject({ reason: 'cooldown' })
    c.advance(3000)
    expect(s.onTheirLine('How do you prioritize work', AUTO)).toMatchObject({ reason: 'rate-limit' })
    c.advance(10_000)
    expect(s.onTheirLine('How do you prioritize work', AUTO).action).toBe('start')
  })

  it('offers talking points after 20 s of talk with no question', () => {
    const c = clock()
    const s = new AnswerScheduler(c.now)
    const long = 'so our company builds tools for logistics teams and we have been growing quickly across several regions'
    expect(s.onTheirLine(long, AUTO)).toMatchObject({ reason: 'not-a-trigger' })
    c.advance(10_000)
    expect(s.onTheirLine(long, AUTO)).toMatchObject({ reason: 'not-a-trigger' })
    c.advance(11_000)
    expect(start(s.onTheirLine(long, AUTO)).kind).toBe('talking-points')
  })

  it('fact-checks claims only when enabled', () => {
    const s = new AnswerScheduler(clock().now)
    const claim = 'Kubernetes was first released in 2014 by Google'
    expect(s.onTheirLine(claim, AUTO)).toMatchObject({ reason: 'not-a-trigger' })
    expect(start(s.onTheirLine(claim, { auto: true, factCheck: true })).kind).toBe('fact-check')
  })

  it('manual requests bypass limits and replace what is in flight; auto off skips', () => {
    const s = new AnswerScheduler(clock().now)
    s.started(7, start(s.onTheirLine('What is a hash map', AUTO)))
    expect(s.manual('answer', 'anything')).toMatchObject({ action: 'start', replaces: 7 })
    expect(s.onTheirLine('What is a hash map', { auto: false, factCheck: false })).toMatchObject({ reason: 'disabled' })
  })

  it('an abandoned answer frees the slot without a cooldown', () => {
    const s = new AnswerScheduler(clock().now)
    s.started(1, start(s.onTheirLine('What is a hash map', AUTO)))
    s.abandoned(1)
    expect(s.busy).toBe(false)
  })
})

describe('enforceContract (C4)', () => {
  it('strips preambles and headings and flags them for a retry', () => {
    const result = enforceContract('Sure! ## Answer\nA thread shares memory with its process.', 'answer')
    expect(result.text).toBe('A thread shares memory with its process.')
    expect(result.violations).toEqual(['preamble', 'heading'])
    expect(needsRetry(result.violations)).toBe(true)
  })

  it('truncates past 55 words at a sentence boundary', () => {
    const sentence = 'This sentence has exactly ten words in it right here. '
    const result = enforceContract(sentence.repeat(8), 'answer')
    expect(result.violations).toEqual(['length'])
    expect(result.text.split(/\s+/).length).toBeLessThanOrEqual(55)
    expect(result.text.endsWith('.')).toBe(true)
    expect(needsRetry(result.violations)).toBe(false)
  })

  it('leaves a clean bulleted answer alone and strips bold markers', () => {
    const clean = '- **Process**: own memory\n- **Thread**: shared memory'
    expect(enforceContract(clean, 'answer')).toEqual({ text: '- Process: own memory\n- Thread: shared memory', violations: [] })
  })

  it('cuts mid-sentence with an ellipsis when there is no boundary', () => {
    expect(truncateAtSentence('one two three four five six', 3)).toBe('one two three…')
  })

  it('flags an empty answer', () => {
    expect(enforceContract('   ', 'answer').violations).toEqual(['empty'])
  })
})
