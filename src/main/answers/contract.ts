import type { AnswerKind } from '../../shared/answers'

export const WORD_LIMITS: Record<AnswerKind, number> = {
  answer: 55,
  'talking-points': 45,
  'fact-check': 35,
  screen: 55,
  elaborate: 140
}

const PREAMBLE = /^\s*(sure|certainly|absolutely|of course|great question|good question|okay|ok|well|so|here(?:'s| is| are)[^:\n]{0,40}:)[\s,!.:-]*/i

export type Violation = 'preamble' | 'heading' | 'length' | 'empty'

export interface ContractResult {
  readonly text: string
  readonly violations: Violation[]
}

function countWords(text: string): number {
  return text.split(/\s+/).filter((word) => word.length > 0).length
}

/** Cuts text to `limit` words, ending at the last sentence or bullet boundary that fits. */
export function truncateAtSentence(text: string, limit: number): string {
  const tokens = text.split(/(\s+)/)
  let words = 0
  let out = ''
  for (const token of tokens) {
    if (/\S/.test(token)) {
      if (words === limit) break
      words++
    }
    out += token
  }
  out = out.trimEnd()
  if (countWords(text) <= limit) return out
  const boundary = Math.max(out.lastIndexOf('. '), out.lastIndexOf('! '), out.lastIndexOf('? '), out.lastIndexOf('\n'))
  const endsSentence = /[.!?]$/.test(out)
  if (endsSentence) return out
  if (boundary > out.length * 0.4) return out.slice(0, boundary + 1).trimEnd()
  return `${out.replace(/[,;:\s]+$/, '')}…`
}

/**
 * The output contract (C4): no preamble ("Sure, …"), no markdown headings, at most
 * N words (55 for an answer), bullets allowed. Returns the cleaned text and what
 * was wrong with the original, so the caller can retry once before accepting.
 */
export function enforceContract(raw: string, kind: AnswerKind): ContractResult {
  const violations: Violation[] = []
  let text = raw.replace(/\r\n/g, '\n').trim()
  if (PREAMBLE.test(text)) {
    violations.push('preamble')
    text = text.replace(PREAMBLE, '')
    text = text.charAt(0).toUpperCase() + text.slice(1)
  }
  if (/^\s*#{1,6}\s/m.test(text)) {
    violations.push('heading')
    text = text
      .split('\n')
      .filter((line) => !/^\s*#{1,6}\s/.test(line))
      .join('\n')
      .trim()
  }
  // Bold markers are noise in a glanceable card.
  text = text.replace(/\*\*(.+?)\*\*/g, '$1')
  const limit = WORD_LIMITS[kind]
  if (countWords(text) > limit) {
    violations.push('length')
    text = truncateAtSentence(text, limit)
  }
  if (text.length === 0) violations.push('empty')
  return { text, violations }
}

/** Violations bad enough to be worth one retry (a long answer is already truncated cleanly). */
export function needsRetry(violations: readonly Violation[]): boolean {
  return violations.includes('heading') || violations.includes('empty') || violations.includes('preamble')
}
