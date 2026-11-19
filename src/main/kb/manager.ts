import { createHash } from 'node:crypto'
import { existsSync, watch, type FSWatcher } from 'node:fs'
import { copyFile, mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { basename, extname, join, relative } from 'node:path'
import type { KbHit, KbStatus } from '../../shared/answers'
import type { Embedder } from './embedder'
import { isSupported, parseFile, SUPPORTED_EXTENSIONS } from './parsers'
import { hybridSearch, type IndexedChunk, type KbStore } from './store'

const README = `Glimpse notes folder
====================

Put your interview notes, prepared answers, resume or job description here
(or use "Add files" in Glimpse → Settings → Notes). Glimpse indexes them on
this PC and searches them before every answer.

Supported: ${SUPPORTED_EXTENSIONS.join(' ')}

Prepared answers are matched best when written like this:

Q: Tell me about a project you are proud of
A: I built ... (your answer, in your words)

or as a markdown heading that is the question:

## Why do you want to work here?
Because ...
`

export interface KnowledgeBaseOptions {
  readonly folder: string
  readonly store: KbStore
  readonly loadEmbedder: () => Promise<Embedder | null>
  readonly onStatus: (status: KbStatus) => void
}

/**
 * The notes folder: keeps the index in step with the files (hash per file, so
 * only changed files are re-read), watches the folder, and copies uploads in.
 */
export class KnowledgeBase {
  private embedder: Embedder | null = null
  private watcher: FSWatcher | null = null
  private debounce: ReturnType<typeof setTimeout> | null = null
  private running: Promise<void> | null = null
  private pending = false
  private state: KbStatus['state'] = 'idle'
  private message = ''
  private lastIndexedAt: number | null = null
  private current: string

  constructor(private readonly options: KnowledgeBaseOptions) {
    this.current = options.folder
  }

  get folder(): string {
    return this.current
  }

  async init(): Promise<void> {
    try {
      this.embedder = await this.options.loadEmbedder()
    } catch (error) {
      this.embedder = null
      this.message = `Meaning-based search is off (${error instanceof Error ? error.message : String(error)}); keyword search still works.`
    }
    await this.open()
  }

  /** Switches to another notes folder (files are not moved); the index follows the new folder. */
  async setFolder(folder: string): Promise<void> {
    this.stopWatching()
    this.current = folder
    await this.open()
  }

  private stopWatching(): void {
    if (this.debounce !== null) clearTimeout(this.debounce)
    this.debounce = null
    this.watcher?.close()
    this.watcher = null
  }

  private async open(): Promise<void> {
    await mkdir(this.current, { recursive: true })
    const readme = join(this.current, 'README.txt')
    if (!existsSync(readme)) await writeFile(readme, README, 'utf8')
    await this.reindex()
    this.watcher = watch(this.current, { recursive: true }, () => {
      if (this.debounce !== null) clearTimeout(this.debounce)
      this.debounce = setTimeout(() => {
        void this.reindex()
      }, 800)
    })
    this.watcher.on('error', (error) => {
      this.watcher?.close()
      this.watcher = null
      this.state = 'error'
      this.message = `Stopped watching the notes folder (${error.message}). Press Re-index after fixing it.`
      this.emit()
    })
  }

  status(): KbStatus {
    return {
      folder: this.current,
      state: this.state,
      files: this.options.store.files(),
      chunks: this.options.store.chunkCount(),
      semantic: this.embedder !== null,
      lastIndexedAt: this.lastIndexedAt,
      message: this.message
    }
  }

  /** Brings the index in line with the folder. Concurrent calls coalesce into one extra pass. */
  reindex(): Promise<void> {
    if (this.running !== null) {
      this.pending = true
      return this.running
    }
    this.running = this.pass().finally(() => {
      this.running = null
      if (this.pending) {
        this.pending = false
        void this.reindex()
      }
    })
    return this.running
  }

  /** Copies the chosen files into the notes folder (never moves or edits the originals). */
  async addFiles(paths: readonly string[]): Promise<{ added: string[]; skipped: string[] }> {
    const added: string[] = []
    const skipped: string[] = []
    for (const source of paths) {
      if (!isSupported(source)) {
        skipped.push(basename(source))
        continue
      }
      const extension = extname(source)
      const stem = basename(source, extension)
      let target = join(this.current, `${stem}${extension}`)
      for (let n = 2; existsSync(target); n++) target = join(this.current, `${stem} (${n})${extension}`)
      await copyFile(source, target)
      added.push(basename(target))
    }
    await this.reindex()
    return { added, skipped }
  }

  async search(query: string, limit = 4): Promise<KbHit[]> {
    let vector: Float32Array | null = null
    try {
      vector = this.embedder === null ? null : ((await this.embedder.embed([query]))[0] ?? null)
    } catch {
      // Meaning search failed for this query; keyword search (vector stays null) still finds prepared answers.
    }
    return hybridSearch(this.options.store, query, vector, limit)
  }

  stop(): void {
    this.watcher?.close()
    this.watcher = null
    if (this.debounce !== null) clearTimeout(this.debounce)
  }

  private async listFiles(dir: string): Promise<string[]> {
    const entries = await readdir(dir, { withFileTypes: true })
    const out: string[] = []
    for (const entry of entries) {
      const full = join(dir, entry.name)
      if (entry.isDirectory()) out.push(...(await this.listFiles(full)))
      else if (entry.isFile() && isSupported(entry.name) && entry.name !== 'README.txt') out.push(full)
    }
    return out
  }

  private async pass(): Promise<void> {
    this.state = 'indexing'
    this.emit()
    try {
      const files = await this.listFiles(this.current)
      const known = this.options.store.hashes()
      const seen = new Set<string>()
      for (const file of files) {
        const name = relative(this.current, file).replace(/\\/g, '/')
        seen.add(name)
        const hash = createHash('sha1').update(await readFile(file)).digest('hex')
        if (known.get(name) === hash) continue
        try {
          const chunks = await parseFile(file)
          this.options.store.replaceFile(name, hash, await this.embedChunks(chunks), null)
        } catch (error) {
          this.options.store.replaceFile(name, hash, [], error instanceof Error ? error.message : String(error))
        }
        this.emit()
      }
      for (const name of known.keys()) if (!seen.has(name)) this.options.store.removeFile(name)
      this.state = 'idle'
      this.lastIndexedAt = Date.now()
    } catch (error) {
      this.state = 'error'
      this.message = `Could not read the notes folder: ${error instanceof Error ? error.message : String(error)}`
    }
    this.emit()
  }

  private async embedChunks(chunks: readonly { kind: 'qa' | 'text'; question: string | null; text: string }[]): Promise<IndexedChunk[]> {
    if (this.embedder === null) return chunks.map((chunk) => ({ ...chunk, vec: null, qvec: null }))
    const out: IndexedChunk[] = []
    for (let i = 0; i < chunks.length; i += 16) {
      const batch = chunks.slice(i, i + 16)
      const vectors = await this.embedder.embed(batch.map((chunk) => (chunk.question === null ? chunk.text : `${chunk.question}\n${chunk.text}`)))
      const questions = batch.filter((chunk) => chunk.question !== null).map((chunk) => chunk.question ?? '')
      const questionVectors = await this.embedder.embed(questions)
      let q = 0
      batch.forEach((chunk, index) => {
        out.push({ ...chunk, vec: vectors[index] ?? null, qvec: chunk.question === null ? null : (questionVectors[q++] ?? null) })
      })
    }
    return out
  }

  private emit(): void {
    this.options.onStatus(this.status())
  }
}
