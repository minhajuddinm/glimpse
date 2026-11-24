import { describe, expect, it } from 'vitest'
import { buildPrompt, BACKGROUND_BUDGET, NOTES_BUDGET } from '../src/main/answers/prompt'
import { estimateTokens } from '../src/main/transcript/buffer'
import type { KbHit } from '../src/shared/answers'
const hit = (text: string, file = 'notes.md'): KbHit => ({ file, kind: 'qa', question: 'Tell me about a project', text, score: 1, similarity: 0.9 })
const build = (notes: KbHit[] = [], context = '') => buildPrompt({ mode: 'interview', kind: 'answer', context, notes,
  trigger: 'How did you test it?', transcript: { segments: [], partials: { them: '', you: '' } } })
describe('fast question-specific answer prompt', () => {
  it('requests grounded synthesis of the exact question', () => {
    const prompt = build([hit('Project Beacon used contract tests and took six weeks.')])
    expect(prompt.system).toContain('rewrite them into a direct spoken answer')
    expect(prompt.system).toContain('Never invent personal experience')
    expect(prompt.user).toContain('>>> Them: How did you test it?')
    expect(prompt.user).toContain('25–40 words')
    expect(prompt.user).toContain('do not paste a prepared answer')
    expect(prompt.user).toContain('Project Beacon used contract tests')
    expect(prompt.maxTokens).toBeLessThanOrEqual(200)
  })
  it('bounds evidence and background, keeping highest ranked evidence first', () => {
    const prompt = build(Array.from({ length: 10 }, (_, i) => hit(`detail ${i} `.repeat(2000), `file-${i}.md`)), 'background '.repeat(20_000))
    const notes = /<your_notes>([\s\S]*?)<\/your_notes>/.exec(prompt.user)?.[1] ?? ''
    const background = /<background>([\s\S]*?)<\/background>/.exec(prompt.system)?.[1] ?? ''
    expect(estimateTokens(notes)).toBeLessThan(NOTES_BUDGET + 150)
    expect(estimateTokens(background)).toBeLessThanOrEqual(BACKGROUND_BUDGET)
    expect(prompt.user.indexOf('file-0.md')).toBeLessThan(prompt.user.indexOf('file-1.md'))
    expect(prompt.user).not.toContain('file-9.md')
  })
  it('retains query-relevant facts at the end of long notes and background', () => {
    const tail = 'The result was a 37 percent reduction in retry failures.'
    const context = 'History about unrelated activities. '.repeat(1800) + tail
    const prompt = build([hit('Background discussion. '.repeat(1800) + 'The test method was fault injection against the retry handler.')], context)
    expect(prompt.user).toContain('fault injection')
    const result = buildPrompt({ mode: 'interview', kind: 'answer', context, notes: [], trigger: 'What was the result?', transcript: { segments: [], partials: {them: '', you: ''} } })
    expect(result.system).toContain(tail)
  })

  it('bounds note metadata and keeps useful evidence from the fourth hit', () => {
    const notes = Array.from({length: 4}, (_, i) => ({ ...hit(`Fact ${i}: the test used contract checks. ` + 'Other detail. '.repeat(1000), `file-${i}.md`), question: 'oversized question '.repeat(2000) }))
    const prompt = build(notes)
    expect(prompt.user).toContain('file-3.md')
    expect(prompt.user.length).toBeLessThan(6000)
    expect(prompt.user).not.toContain('oversized question '.repeat(20))
  })

})
