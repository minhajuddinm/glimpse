/** Words that open a question when they come first. */
const QUESTION_STARTS = new Set(['what', 'how', 'why', 'when', 'where', 'who', 'whom', 'whose', 'which'])
/** Auxiliary verbs that open a yes/no question ("can you…", "do you…"); weaker on their own. */
const AUX_STARTS = new Set(['can', 'could', 'would', 'should', 'do', 'does', 'did', 'are', 'is', 'will', 'have', 'has', 'were', 'was', 'may', 'might'])
/** Requests addressed to the listener that call for an answer even without a question mark. */
const IMPERATIVES: readonly RegExp[] = [
  /\bwalk (me|us) through\b/,
  /\btalk (me|us) through\b/,
  /\btell (me|us) (about|how|why|what|more)\b/,
  /\bexplain\b/,
  /\bgive (me|us) an? (example|overview|sense)\b/,
  /\bdescribe\b/,
  /\bhow would you\b/,
  /\bwhat would you\b/,
  /\bwhy (do|did|would|should) you\b/,
  /\bcan you (share|tell|explain|describe|walk)\b/
]

function words(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9'? ]+/g, ' ')
    .split(/\s+/)
    .filter((word) => word.length > 0)
}

/**
 * How strongly an utterance asks for an answer, 0 to 1 (C1). Fire at 0.6 or more.
 * Recognisers often drop the "?", so leading question words and imperatives
 * addressed to the listener count as much as punctuation.
 */
export function questionScore(text: string): number {
  const trimmed = text.trim()
  const list = words(trimmed)
  if (list.length < 2) return 0
  const lower = trimmed.toLowerCase()
  const first = (list[0] ?? '').replace(/\?/g, '')
  let score = 0
  if (trimmed.endsWith('?')) score += 0.6
  if (QUESTION_STARTS.has(first)) score += 0.6
  else if (AUX_STARTS.has(first) && /\b(you|your|we|they|it|this|that|there)\b/.test(lower)) score += 0.6
  else if (AUX_STARTS.has(first)) score += 0.3
  if (IMPERATIVES.some((pattern) => pattern.test(lower))) score += 0.7
  if (/\b(you|your|yourself)\b/.test(lower)) score += 0.1
  if (list.length < 4) score -= 0.2
  return Math.max(0, Math.min(1, score))
}

const MONTHS = /\b(january|february|march|april|may|june|july|august|september|october|november|december)\b/

/**
 * A factual claim worth checking (C1, optional): a statement with a number, a year,
 * a date or a proper name, that is not itself a question.
 */
export function isCheckableClaim(text: string): boolean {
  if (questionScore(text) >= 0.6) return false
  const lower = text.toLowerCase()
  const list = words(text)
  if (list.length < 5) return false
  const hasNumber = /\d/.test(text) || /\b(hundred|thousand|million|billion|percent)\b/.test(lower)
  const hasDate = MONTHS.test(lower) || /\b(19|20)\d{2}\b/.test(text)
  // A capitalised word that is not the first word: a likely name or product.
  const hasName = text
    .trim()
    .split(/\s+/)
    .slice(1)
    .some((word) => /^[A-Z][a-z]{2,}/.test(word) && !/^(I|I'm|I've|I'd)$/.test(word))
  return hasNumber || hasDate || hasName
}

export function tokenSet(text: string): Set<string> {
  return new Set(words(text).map((word) => word.replace(/\?/g, '')).filter((word) => word.length > 0))
}

export function jaccardText(a: string, b: string): number {
  const setA = tokenSet(a)
  const setB = tokenSet(b)
  if (setA.size === 0 || setB.size === 0) return 0
  let shared = 0
  for (const word of setA) if (setB.has(word)) shared++
  return shared / (setA.size + setB.size - shared)
}
