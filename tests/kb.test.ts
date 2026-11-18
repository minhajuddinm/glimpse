import { describe, expect, it } from 'vitest'
import { openDatabase } from '../src/main/db'
import { chunkCsv, chunkDocument, chunkQaList, parseCsv } from '../src/main/kb/chunk'
import { KbStore, cosine, hybridSearch, instantAnswer, queryTerms, type IndexedChunk } from '../src/main/kb/store'

describe('chunkDocument', () => {
  it('extracts Q:/A: pairs and keeps the rest as passages', () => {
    const doc = [
      'My interview notes',
      '',
      'Q: Tell me about yourself',
      'A: I am a final-year software student who builds developer tools.',
      'I interned at Shopify on the payments team.',
      '',
      'Question: What is your biggest weakness?',
      'Answer: I over-polish small details, so I now time-box them.',
      '',
      'Some general background paragraph about my projects and interests that is long enough to keep.'
    ].join('\n')
    const chunks = chunkDocument(doc)
    const qa = chunks.filter((chunk) => chunk.kind === 'qa')
    expect(qa.map((chunk) => chunk.question)).toEqual(['Tell me about yourself', 'What is your biggest weakness?'])
    expect(qa[0]?.text).toContain('interned at Shopify')
    expect(chunks.some((chunk) => chunk.kind === 'text' && chunk.text.includes('general background'))).toBe(true)
  })

  it('treats a markdown heading that is a question as a prepared answer', () => {
    const chunks = chunkDocument('## Why do you want to work here?\nBecause your team ships developer tools I use daily.\n\n## Projects\nA long list.')
    expect(chunks[0]).toEqual({ kind: 'qa', question: 'Why do you want to work here?', text: 'Because your team ships developer tools I use daily.' })
  })

  it('splits long text into overlapping ~230-word passages', () => {
    const words = Array.from({ length: 600 }, (_, i) => `w${i}`).join(' ')
    const chunks = chunkDocument(words)
    expect(chunks.length).toBeGreaterThanOrEqual(3)
    expect(chunks.every((chunk) => chunk.text.split(' ').length <= 230)).toBe(true)
    expect(chunks[1]?.text.startsWith('w190')).toBe(true)
  })
})

describe('Q&A lists', () => {
  it('reads JSON items and CSV with or without a header', () => {
    expect(chunkQaList([{ question: 'Q1?', answer: 'A1' }, { q: 'Q2?', a: 'A2' }, { nope: 1 }])).toHaveLength(2)
    expect(parseCsv('question,answer\n"Why, though?","Because ""reasons"""\n')).toEqual([
      ['question', 'answer'],
      ['Why, though?', 'Because "reasons"']
    ])
    expect(chunkCsv('question,answer\nWhat is X?,X is Y\n')).toEqual([{ kind: 'qa', question: 'What is X?', text: 'X is Y' }])
    expect(chunkCsv('What is X?,X is Y\n')).toEqual([{ kind: 'qa', question: 'What is X?', text: 'X is Y' }])
  })
})

/** A toy embedding: word-hash bag of words, enough to test ranking plumbing. */
function embed(text: string): Float32Array {
  const vec = new Float32Array(64)
  for (const word of queryTerms(text)) {
    let h = 0
    for (const char of word) h = (h * 31 + char.charCodeAt(0)) % 64
    vec[h] = (vec[h] ?? 0) + 1
  }
  return vec
}

function index(store: KbStore): void {
  const chunks: IndexedChunk[] = chunkDocument(
    'Q: Tell me about a project you are proud of\nA: I built Glimpse, a real-time meeting copilot.\n\nQ: What is your biggest weakness\nA: I over-polish details.\n\nKubernetes notes: we ran Postgres on Kubernetes in production with operators.'
  ).map((chunk) => ({ ...chunk, vec: embed(chunk.text), qvec: chunk.question === null ? null : embed(chunk.question) }))
  store.replaceFile('notes.md', 'h1', chunks, null)
}

describe('KbStore and hybrid search', () => {
  it('finds a prepared answer by keywords and flags an instant match', () => {
    const store = new KbStore(openDatabase(':memory:'))
    index(store)
    const query = 'Tell me about a project you are proud of'
    const hits = hybridSearch(store, query, embed(query))
    expect(hits[0]?.question).toBe('Tell me about a project you are proud of')
    expect(instantAnswer(hits)?.text).toContain('Glimpse')
  })

  it('returns passages for topic questions and no instant answer for weak matches', () => {
    const store = new KbStore(openDatabase(':memory:'))
    index(store)
    const hits = hybridSearch(store, 'How did you run Postgres in production?', null)
    expect(hits[0]?.kind).toBe('text')
    expect(hits[0]?.text).toContain('Kubernetes')
    expect(instantAnswer(hits)).toBeNull()
  })

  it('replaces and removes files, keeping the keyword index in sync', () => {
    const store = new KbStore(openDatabase(':memory:'))
    index(store)
    expect(store.files()).toEqual([{ name: 'notes.md', chunks: 3, qaPairs: 2, error: null }])
    store.replaceFile('notes.md', 'h2', [], null)
    expect(store.keyword('Kubernetes', 5)).toEqual([])
    store.removeFile('notes.md')
    expect(store.files()).toEqual([])
    expect(store.chunkCount()).toBe(0)
  })

  it('ignores stop words and punctuation in queries', () => {
    expect(queryTerms('What is "your" weakness?! OR NOT')).toEqual(['weakness', 'not'])
    expect(cosine(new Float32Array([1, 0]), new Float32Array([1, 0]))).toBe(1)
  })
})
