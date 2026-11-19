// Idle cost of the speech engine: CPU time to process 60 s of silence and 60 s of faint room noise.
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join, resolve } from 'node:path'
import { SAMPLE_RATE, SourceRecognizer } from '../src/main/asr/engine.ts'
import { recognizerConfig, vadConfig, type ModelEntry } from '../src/main/asr/config.ts'
import type { SherpaModule, SherpaVadModule } from '../src/main/asr/sherpa-types'

const root = resolve(import.meta.dirname, '..')
const sherpa = createRequire(import.meta.url)('sherpa-onnx-node') as SherpaModule & SherpaVadModule
const registry = JSON.parse(readFileSync(join(root, 'src/main/asr/models.json'), 'utf8')) as ModelEntry[]
const model = registry.find((entry) => entry.id === 'kroko-en')
if (model === undefined) throw new Error('kroko-en missing')
const recognizer = new sherpa.OnlineRecognizer(recognizerConfig(model, join(root, 'models'), 2, 1.2))
const vad = new sherpa.Vad(vadConfig(join(root, 'models'), 0.4), 30)
let events = 0
const source = new SourceRecognizer(recognizer, 'them', () => { events++ }, () => performance.now(), vad, 400)
const CHUNK = SAMPLE_RATE / 10
for (const [label, level] of [['silence', 0], ['room noise', 0.01]] as const) {
  const start = process.cpuUsage()
  for (let i = 0; i < 600; i++) {
    const chunk = new Float32Array(CHUNK)
    if (level > 0) for (let j = 0; j < CHUNK; j++) chunk[j] = (Math.random() * 2 - 1) * level
    source.accept(chunk)
  }
  const used = process.cpuUsage(start)
  console.log(`${label}: ${((used.user + used.system) / 1000 / 60_000 * 100).toFixed(1)}% of one core per stream (events ${events})`)
}
