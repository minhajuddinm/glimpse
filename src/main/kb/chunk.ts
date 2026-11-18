export interface Chunk {
  readonly kind: 'qa' | 'text'
  /** For prepared answers: the question as written in the notes. */
  readonly question: string | null
  readonly text: string
}

const TARGET_WORDS = 230
const OVERLAP_WORDS = 40

const QUESTION_LINE = /^\s*(?:[-*]\s*)?(?:\*\*)?(?:q(?:uestion)?\s*\d*\s*[:.)-])\s*(.+?)(?:\*\*)?\s*$/i
const ANSWER_LINE = /^\s*(?:[-*]\s*)?(?:\*\*)?(?:a(?:nswer)?\s*\d*\s*[:.)-])(?:\*\*)?\s*(.*)$/i
const HEADING = /^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$/

function wordCount(text: string): number {
  return text.split(/\s+/).filter((word) => word.length > 0).length
}

/**
 * Prepared answers written as "Q: … / A: …" (or "Question: / Answer:"), or as a
 * markdown heading that is a question followed by its body.
 */
function extractQa(lines: readonly string[]): { chunks: Chunk[]; used: Set<number> } {
  const chunks: Chunk[] = []
  const used = new Set<number>()
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? ''
    const q = QUESTION_LINE.exec(line)
    const heading = HEADING.exec(line)
    const headingQuestion = heading?.[1]?.trim().endsWith('?') === true ? heading[1].trim() : null
    const question = q?.[1]?.trim() ?? headingQuestion
    if (question === null || question.length === 0) continue

    const body: string[] = []
    let j = i + 1
    // "A:" may be on the next line, or the heading's body follows directly.
    // "Q: / A:" answers end at the first blank line after some text; a question heading owns its whole section.
    const endsAtBlank = q !== null
    for (; j < lines.length; j++) {
      const next = lines[j] ?? ''
      if (QUESTION_LINE.test(next) || HEADING.test(next)) break
      if (endsAtBlank && next.trim() === '' && body.some((part) => part.trim() !== '')) break
      const answer = ANSWER_LINE.exec(next)
      body.push(answer !== null ? (answer[1] ?? '') : next)
    }
    const text = body.join('\n').trim()
    if (text.length === 0) continue
    chunks.push({ kind: 'qa', question, text })
    for (let k = i; k < j; k++) used.add(k)
    i = j - 1
  }
  return { chunks, used }
}

/** Splits free text into ~230-word passages with a 40-word overlap, on paragraph boundaries where possible. */
function passages(text: string): Chunk[] {
  const paragraphs = text
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.replace(/\s+/g, ' ').trim())
    .filter((paragraph) => paragraph.length > 0)
  const chunks: Chunk[] = []
  let current: string[] = []
  /** True once `current` holds text that is not just the overlap carried from the previous passage. */
  let fresh = false
  const flush = (): void => {
    if (!fresh) return
    fresh = false
    chunks.push({ kind: 'text', question: null, text: current.join(' ') })
    const words = current.join(' ').split(/\s+/)
    current = words.length > OVERLAP_WORDS ? [words.slice(-OVERLAP_WORDS).join(' ')] : []
  }
  for (const paragraph of paragraphs) {
    const words = paragraph.split(/\s+/)
    if (words.length > TARGET_WORDS * 1.5) {
      flush()
      for (let start = 0; start < words.length; start += TARGET_WORDS - OVERLAP_WORDS) {
        chunks.push({ kind: 'text', question: null, text: words.slice(start, start + TARGET_WORDS).join(' ') })
        if (start + TARGET_WORDS >= words.length) break
      }
      current = []
      fresh = false
      continue
    }
    if (wordCount(current.join(' ')) + words.length > TARGET_WORDS) flush()
    current.push(paragraph)
    fresh = true
  }
  if (fresh) chunks.push({ kind: 'text', question: null, text: current.join(' ') })
  return chunks
}

/** Turns a notes document into searchable chunks: prepared Q&A pairs first, the rest as passages. */
export function chunkDocument(text: string): Chunk[] {
  const lines = text.replace(/\r\n/g, '\n').split('\n')
  const { chunks, used } = extractQa(lines)
  const rest = lines.filter((_, index) => !used.has(index)).join('\n')
  return [...chunks, ...passages(rest)]
}

/** Q&A lists from JSON: [{question, answer}] or {questions: [...]} with q/a or question/answer keys. */
export function chunkQaList(items: readonly unknown[]): Chunk[] {
  const chunks: Chunk[] = []
  for (const item of items) {
    if (typeof item !== 'object' || item === null) continue
    const record = item as Record<string, unknown>
    const question = record['question'] ?? record['q']
    const answer = record['answer'] ?? record['a']
    if (typeof question === 'string' && typeof answer === 'string' && question.trim() !== '' && answer.trim() !== '') {
      chunks.push({ kind: 'qa', question: question.trim(), text: answer.trim() })
    }
  }
  return chunks
}

/** Minimal CSV reader (quoted fields, doubled quotes) for question,answer files. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  for (let i = 0; i < text.length; i++) {
    const char = text[i] ?? ''
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') {
        field += '"'
        i++
      } else if (char === '"') quoted = false
      else field += char
    } else if (char === '"') quoted = true
    else if (char === ',') {
      row.push(field)
      field = ''
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && text[i + 1] === '\n') i++
      row.push(field)
      rows.push(row)
      row = []
      field = ''
    } else field += char
  }
  if (field !== '' || row.length > 0) {
    row.push(field)
    rows.push(row)
  }
  return rows.filter((cells) => cells.some((cell) => cell.trim() !== ''))
}

export function chunkCsv(text: string): Chunk[] {
  const rows = parseCsv(text)
  const header = (rows[0] ?? []).map((cell) => cell.trim().toLowerCase())
  const qIndex = header.findIndex((cell) => cell === 'question' || cell === 'q')
  const aIndex = header.findIndex((cell) => cell === 'answer' || cell === 'a')
  const hasHeader = qIndex >= 0 && aIndex >= 0
  const qi = hasHeader ? qIndex : 0
  const ai = hasHeader ? aIndex : 1
  return chunkQaList(rows.slice(hasHeader ? 1 : 0).map((cells) => ({ question: cells[qi], answer: cells[ai] })))
}
