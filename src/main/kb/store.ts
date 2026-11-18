import { z } from 'zod'
import type { KbFile, KbHit } from '../../shared/answers'
import { transaction, type Db } from '../db'
import type { Chunk } from './chunk'

export interface IndexedChunk extends Chunk {
  readonly vec: Float32Array | null
  readonly qvec: Float32Array | null
}

interface VectorRow {
  readonly id: number
  readonly vec: Float32Array | null
  readonly qvec: Float32Array | null
}

const STOPWORDS = new Set(
  'a an and are as at be but by can could did do does for from had has have how i if in into is it its me my of on or our so that the their them then there these they this to us was we were what when where which who why will with would you your yourself'.split(' ')
)

/** Words worth searching for: no stop words, no punctuation (FTS5 query syntax stays safe). */
export function queryTerms(text: string): string[] {
  return [...new Set(text.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/))].filter(
    (word) => word.length >= 2 && !STOPWORDS.has(word)
  )
}

export function cosine(a: Float32Array, b: Float32Array): number {
  let dot = 0
  let na = 0
  let nb = 0
  for (let i = 0; i < a.length; i++) {
    const x = a[i] ?? 0
    const y = b[i] ?? 0
    dot += x * y
    na += x * x
    nb += y * y
  }
  return na === 0 || nb === 0 ? 0 : dot / Math.sqrt(na * nb)
}

const toBlob = (vec: Float32Array | null): Uint8Array | null => (vec === null ? null : new Uint8Array(vec.buffer.slice(vec.byteOffset, vec.byteOffset + vec.byteLength)))
const fromBlob = (blob: unknown): Float32Array | null =>
  blob instanceof Uint8Array && blob.byteLength % 4 === 0 ? new Float32Array(blob.buffer.slice(blob.byteOffset, blob.byteOffset + blob.byteLength)) : null

const ChunkRowSchema = z.object({ id: z.number(), file: z.string(), kind: z.enum(['qa', 'text']), question: z.string().nullable(), text: z.string() })
const FileRowSchema = z.object({ path: z.string(), hash: z.string(), chunks: z.number(), qa: z.number(), error: z.string().nullable() })

/** The notes index in SQLite: chunks, an FTS5 keyword index and the embedding vectors. */
export class KbStore {
  private vectors: VectorRow[] | null = null

  constructor(private readonly db: Db) {}

  replaceFile(path: string, hash: string, chunks: readonly IndexedChunk[], error: string | null): void {
    transaction(this.db, () => {
      this.deleteChunks(path)
      const insertChunk = this.db.prepare('INSERT INTO kb_chunks (file, kind, question, text, vec, qvec) VALUES (?, ?, ?, ?, ?, ?)')
      const insertFts = this.db.prepare('INSERT INTO kb_fts (rowid, question, text) VALUES (?, ?, ?)')
      for (const chunk of chunks) {
        const result = insertChunk.run(path, chunk.kind, chunk.question, chunk.text, toBlob(chunk.vec), toBlob(chunk.qvec))
        insertFts.run(Number(result.lastInsertRowid), chunk.question ?? '', chunk.text)
      }
      this.db
        .prepare(
          `INSERT INTO kb_files (path, hash, chunks, qa, error, indexed_at) VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT(path) DO UPDATE SET hash = excluded.hash, chunks = excluded.chunks, qa = excluded.qa, error = excluded.error, indexed_at = excluded.indexed_at`
        )
        .run(path, hash, chunks.length, chunks.filter((chunk) => chunk.kind === 'qa').length, error, Date.now())
    })
    this.vectors = null
  }

  removeFile(path: string): void {
    transaction(this.db, () => {
      this.deleteChunks(path)
      this.db.prepare('DELETE FROM kb_files WHERE path = ?').run(path)
    })
    this.vectors = null
  }

  hashes(): Map<string, string> {
    const rows = z.array(FileRowSchema).parse(this.db.prepare('SELECT path, hash, chunks, qa, error FROM kb_files').all())
    return new Map(rows.map((row) => [row.path, row.hash]))
  }

  files(): KbFile[] {
    return z
      .array(FileRowSchema)
      .parse(this.db.prepare('SELECT path, hash, chunks, qa, error FROM kb_files ORDER BY path').all())
      .map((row) => ({ name: row.path, chunks: row.chunks, qaPairs: row.qa, error: row.error }))
  }

  chunkCount(): number {
    const row = z.object({ n: z.number() }).parse(this.db.prepare('SELECT COUNT(*) AS n FROM kb_chunks').get())
    return row.n
  }

  /** BM25 keyword search; the question column weighs double. Returns chunk ids, best first. */
  keyword(query: string, limit: number): number[] {
    const terms = queryTerms(query)
    if (terms.length === 0) return []
    const match = terms.map((term) => `"${term}"`).join(' OR ')
    const rows = z
      .array(z.object({ id: z.number() }))
      .parse(this.db.prepare('SELECT rowid AS id FROM kb_fts WHERE kb_fts MATCH ? ORDER BY bm25(kb_fts, 2.0, 1.0) LIMIT ?').all(match, limit))
    return rows.map((row) => row.id)
  }

  /** Nearest chunks by embedding; a prepared answer also matches on its question. */
  semantic(query: Float32Array, limit: number): { id: number; similarity: number }[] {
    this.vectors ??= z
      .array(z.object({ id: z.number(), vec: z.unknown(), qvec: z.unknown() }))
      .parse(this.db.prepare('SELECT id, vec, qvec FROM kb_chunks').all())
      .map((row) => ({ id: row.id, vec: fromBlob(row.vec), qvec: fromBlob(row.qvec) }))
    return this.vectors
      .map((row) => ({
        id: row.id,
        similarity: Math.max(row.vec === null ? -1 : cosine(query, row.vec), row.qvec === null ? -1 : cosine(query, row.qvec))
      }))
      .filter((row) => row.similarity > -1)
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, limit)
  }

  chunk(id: number): Omit<KbHit, 'score' | 'similarity'> | null {
    const row = ChunkRowSchema.safeParse(this.db.prepare('SELECT id, file, kind, question, text FROM kb_chunks WHERE id = ?').get(id))
    if (!row.success) return null
    return { file: row.data.file, kind: row.data.kind, question: row.data.question, text: row.data.text }
  }

  private deleteChunks(path: string): void {
    const ids = z.array(z.object({ id: z.number() })).parse(this.db.prepare('SELECT id FROM kb_chunks WHERE file = ?').all(path))
    const deleteFts = this.db.prepare('DELETE FROM kb_fts WHERE rowid = ?')
    for (const { id } of ids) deleteFts.run(id)
    this.db.prepare('DELETE FROM kb_chunks WHERE file = ?').run(path)
  }
}

/** Keyword matches add at most this much on top of the meaning similarity (0–1): enough to break near-ties only. */
export const KEYWORD_BONUS = 0.1
/**
 * A prepared Q&A whose question is at least this similar to what was asked is shown instantly.
 * Calibrated with npm run bench:kb on bge-small: rewordings scored 0.61–0.82, unrelated questions 0.44–0.49.
 */
export const INSTANT_SIMILARITY = 0.57

/**
 * Hybrid search. With embeddings: rank by meaning (cosine similarity), plus a small
 * bonus for keyword (BM25) matches so an exact term helps without overruling meaning.
 * (Rank fusion was tried first: one shared word like "handle" outvoted a clearly
 * better meaning match.) Without embeddings: keyword ranking alone.
 */
export function hybridSearch(store: KbStore, query: string, queryVec: Float32Array | null, limit = 4): KbHit[] {
  const keyword = store.keyword(query, 20)
  const keywordBonus = new Map(keyword.map((id, rank) => [id, KEYWORD_BONUS / (rank + 1)]))
  let ranked: { id: number; score: number; similarity: number | null }[]
  if (queryVec === null) {
    ranked = keyword.map((id, rank) => ({ id, score: 1 / (rank + 1), similarity: null }))
  } else {
    const semantic = store.semantic(queryVec, 20)
    const ids = new Set([...semantic.map((hit) => hit.id), ...keyword])
    const similarity = new Map(semantic.map((hit) => [hit.id, hit.similarity]))
    ranked = [...ids].map((id) => ({
      id,
      score: (similarity.get(id) ?? 0) + (keywordBonus.get(id) ?? 0),
      similarity: similarity.get(id) ?? null
    }))
  }
  return ranked
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .flatMap(({ id, score, similarity }) => {
      const chunk = store.chunk(id)
      return chunk === null ? [] : [{ ...chunk, score, similarity }]
    })
}

/** The prepared answer to show immediately, if the best hit is a close match to a Q&A question. */
export function instantAnswer(hits: readonly KbHit[]): KbHit | null {
  const top = hits[0]
  if (top === undefined || top.kind !== 'qa' || top.similarity === null) return null
  return top.similarity >= INSTANT_SIMILARITY ? top : null
}
