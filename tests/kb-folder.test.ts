import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { openDatabase } from '../src/main/db'
import { KnowledgeBase } from '../src/main/kb/manager'
import { KbStore } from '../src/main/kb/store'

// Scratch space inside the repo (git-ignored), not on the Windows drive.
const scratch = resolve(import.meta.dirname, '..', '.cache', 'test-kb-folder')

afterEach(() => {
  rmSync(scratch, { recursive: true, force: true })
})

describe('KnowledgeBase.setFolder', () => {
  it('re-indexes from the new folder and drops the old folder’s files', async () => {
    const first = join(scratch, 'first')
    const second = join(scratch, 'second')
    mkdirSync(first, { recursive: true })
    mkdirSync(second, { recursive: true })
    writeFileSync(join(first, 'a.md'), 'Q: Tell me about yourself\nA: I build tools.')
    writeFileSync(join(second, 'b.md'), 'Q: Why this company?\nA: Your mission.')
    const kb = new KnowledgeBase({ folder: first, store: new KbStore(openDatabase(':memory:')), loadEmbedder: () => Promise.resolve(null), onStatus: () => undefined })
    await kb.init()
    expect(kb.status().files.map((file) => file.name)).toEqual(['a.md'])
    await kb.setFolder(second)
    expect(kb.folder).toBe(second)
    expect(kb.status().files.map((file) => file.name)).toEqual(['b.md'])
    expect((await kb.search('Why this company')).map((hit) => hit.file)).toEqual(['b.md'])
    kb.stop()
  })
})
