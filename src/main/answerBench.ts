import { join } from 'node:path'
import { app } from 'electron'
import type { Answer } from '../shared/answers'
import { readContext } from './answerHandlers'
import { anthropicProvider, groqProvider, type LlmProvider } from './answers/llm'
import { AnswerScheduler } from './answers/scheduler'
import { AnswerService } from './answers/service'
import { openDatabase } from './db'
import { loadEmbedder } from './kb/embedder'
import { KnowledgeBase } from './kb/manager'
import { KbStore } from './kb/store'
import { SecretStore } from './secrets'
import { dataPaths } from './paths'
import { SettingsStore } from './settingsStore'

const QUESTIONS = [
  'Tell me about yourself',
  'What is the difference between a process and a thread?',
  'Why do you want to work here?',
  'How would you design a URL shortener?',
  'What is your biggest weakness?',
  'Explain what a REST API is',
  'Walk me through a project you are proud of',
  'What does Big O notation measure?'
]

function percentile(values: readonly number[], p: number): number {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))] ?? Number.NaN
}

const words = (text: string): number => text.split(/\s+/).filter((word) => word.length > 0).length

/**
 * `--answer-bench`: runs real questions through the live answer pipeline with the keys
 * saved in Settings (real profile, real notes folder) and prints time-to-first-words (G7)
 * and the output contract. Never prints keys. Close the running app first.
 */
export async function runAnswerBench(): Promise<number> {
  const db = openDatabase(join(app.getPath('userData'), 'glimpse.db'))
  const settings = new SettingsStore(db)
  const secrets = new SecretStore(settings)
  await secrets.load()
  const kb = new KnowledgeBase({
    folder: settings.get().notesFolder !== '' ? settings.get().notesFolder : dataPaths().defaultNotes,
    store: new KbStore(db),
    loadEmbedder: () => loadEmbedder(app.isPackaged ? join(process.resourcesPath, 'models') : join(app.getAppPath(), 'models')),
    onStatus: () => undefined
  })
  await kb.init()
  kb.stop()
  const status = kb.status()
  console.log(`NOTES files=${String(status.files.length)} chunks=${String(status.chunks)} semantic=${String(status.semantic)}`)

  const providers: LlmProvider[] = []
  const anthropicKey = secrets.get('anthropic')
  const groqKey = secrets.get('groq')
  if (anthropicKey !== null) providers.push(anthropicProvider(anthropicKey))
  if (groqKey !== null) providers.push(groqProvider(groqKey))
  if (providers.length === 0) {
    console.log('NO_KEYS saved in Settings → Answers')
    return 2
  }

  let failed = false
  for (const provider of providers) {
    const service = new AnswerService({
      scheduler: new AnswerScheduler(() => Date.now()),
      search: (query) => kb.search(query),
      provider: () => provider,
      settings: () => settings.get(),
      context: () => readContext(settings),
      transcript: () => ({ segments: [], partials: { them: '', you: '' } }),
      emit: () => undefined,
      now: () => Date.now()
    })
    const firsts: number[] = []
    const results: Answer[] = []
    for (const question of QUESTIONS) {
      await service.ask(question)
      const answer = service.snapshot().answers[0]
      if (answer === undefined) continue
      results.push(answer)
      if (answer.firstTextAt !== null) firsts.push(answer.firstTextAt - answer.askedAt)
      const first = answer.firstTextAt === null ? '-' : String(answer.firstTextAt - answer.askedAt)
      console.log(
        `${provider.id} | ${answer.status} | first=${first}ms total=${String((answer.doneAt ?? Date.now()) - answer.askedAt)}ms words=${String(words(answer.text))} origin=${answer.origin} | ${question}\n    ${answer.status === 'error' ? `ERROR ${answer.error ?? ''}` : answer.text.replace(/\n/g, ' / ')}`
      )
      await new Promise((resolve) => setTimeout(resolve, provider.id === 'groq' ? 2500 : 300))
    }
    // Elaborate (deep model) once.
    await service.elaborate()
    const deep = service.snapshot().answers[0]
    if (deep !== undefined) {
      console.log(`${provider.id} | elaborate ${deep.status} model=${deep.model ?? '-'} words=${String(words(deep.text))}${deep.status === 'error' ? ` ERROR ${deep.error ?? ''}` : ''}`)
    }
    const errors = results.filter((answer) => answer.status === 'error').length
    const overLimit = results.filter((answer) => words(answer.text) > 55).length
    const p50 = percentile(firsts, 50)
    const p95 = percentile(firsts, 95)
    const pass = errors === 0 && overLimit === 0 && p95 <= 1500
    if (!pass) failed = true
    console.log(`SUMMARY ${provider.id} n=${String(results.length)} errors=${String(errors)} over55=${String(overLimit)} first-words p50=${String(p50)}ms p95=${String(p95)}ms G7=${pass ? 'PASS' : 'FAIL'}`)
  }
  db.close()
  return failed ? 1 : 0
}
