const ONES = [
  'zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve',
  'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'
] as const
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'] as const

/** Spells out a non-negative integer in English ("45000" → "forty five thousand"). */
export function numberToWords(n: number): string {
  if (!Number.isInteger(n) || n < 0) return String(n)
  if (n < 20) return ONES[n] ?? String(n)
  if (n < 100) {
    const rest = n % 10
    return `${TENS[Math.floor(n / 10)] ?? ''}${rest > 0 ? ` ${ONES[rest] ?? ''}` : ''}`
  }
  if (n < 1000) {
    const rest = n % 100
    return `${ONES[Math.floor(n / 100)] ?? ''} hundred${rest > 0 ? ` ${numberToWords(rest)}` : ''}`
  }
  if (n < 1_000_000) {
    const rest = n % 1000
    return `${numberToWords(Math.floor(n / 1000))} thousand${rest > 0 ? ` ${numberToWords(rest)}` : ''}`
  }
  if (n < 1_000_000_000) {
    const rest = n % 1_000_000
    return `${numberToWords(Math.floor(n / 1_000_000))} million${rest > 0 ? ` ${numberToWords(rest)}` : ''}`
  }
  return String(n)
}

const COMPOUNDS: ReadonlyArray<readonly [RegExp, string]> = [
  [/\bper cent\b/g, 'percent'],
  [/\bhashmap\b/g, 'hash map'],
  [/\bkey value\b/g, 'key value']
]

/**
 * Brings a transcript and its reference to one form so that formatting choices
 * are not counted as recognition errors: digits vs spelled numbers, "$" and "%",
 * punctuation, case, and spelled-out acronyms ("a p i" and "api" are the same).
 */
export function normalizeForWer(text: string): string[] {
  let value = text.toLowerCase()
  value = value.replace(/\$\s?(\d[\d,.]*)/g, '$1 dollars')
  value = value.replace(/(\d)\s?%/g, '$1 percent')
  // Thousands written "45,000" or "45 000".
  value = value.replace(/(\d),(?=\d{3}\b)/g, '$1')
  let previous = ''
  while (previous !== value) {
    previous = value
    value = value.replace(/(\d+) (\d{3})\b/g, '$1$2')
  }
  value = value.replace(/\d+/g, (digits) => ` ${numberToWords(Number(digits))} `)
  value = value.replace(/-/g, ' ').replace(/[^a-z' ]+/g, ' ')
  for (const [pattern, replacement] of COMPOUNDS) value = value.replace(pattern, replacement)

  const words = value.split(/\s+/).filter((word) => word.length > 0)
  // Runs of single letters are one spelled-out acronym: "a p i" → "api".
  const joined: string[] = []
  for (let i = 0; i < words.length; ) {
    let end = i
    while (end < words.length && (words[end]?.length ?? 0) === 1) end++
    if (end - i >= 2) {
      joined.push(words.slice(i, end).join(''))
      i = end
    } else {
      joined.push(words[i] ?? '')
      i++
    }
  }
  return joined
}

/** Word-level edit distance (substitutions, insertions and deletions). */
export function wordErrors(reference: readonly string[], hypothesis: readonly string[]): number {
  const previous = Array.from({ length: hypothesis.length + 1 }, (_, j) => j)
  for (let i = 1; i <= reference.length; i++) {
    let diagonal = previous[0] ?? 0
    previous[0] = i
    for (let j = 1; j <= hypothesis.length; j++) {
      const above = previous[j] ?? 0
      const cost = reference[i - 1] === hypothesis[j - 1] ? 0 : 1
      previous[j] = Math.min(above + 1, (previous[j - 1] ?? 0) + 1, diagonal + cost)
      diagonal = above
    }
  }
  return previous[hypothesis.length] ?? 0
}
