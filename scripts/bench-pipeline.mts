/**
 * Gate G6: voice-to-transcript latency through the real recognition engine
 * (SourceRecognizer + endpoint detection + padding), on bench/audio.
 *
 *   npm run bench:pipeline -- [--model kroko-en] [--endpoint 0.5]
 *
 * Each utterance is fed as 250 ms pre-roll, the speech, then silence in 100 ms
 * chunks until the final arrives. Latency = audio time from end of speech to the
 * endpoint + compute to finish, so it is what a live caller would wait.
 */
import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join, resolve } from 'node:path'
import { performance } from 'node:perf_hooks'
import { SAMPLE_RATE, SourceRecognizer, type AsrEvent } from '../src/main/asr/engine.ts'
import { recognizerConfig, vadConfig, type ModelEntry } from '../src/main/asr/config.ts'
import type { SherpaModule, SherpaVadModule } from '../src/main/asr/sherpa-types'
import { normalizeForWer, wordErrors } from '../src/shared/wer.ts'

const root = resolve(import.meta.dirname, '..')
const sherpa = createRequire(import.meta.url)('sherpa-onnx-node') as SherpaModule & SherpaVadModule
const arg = (name: string, fallback: string): string => {
  const index = process.argv.indexOf(`--${name}`)
  return index >= 0 ? (process.argv[index + 1] ?? fallback) : fallback
}
const modelId = arg('model', 'kroko-en')
const endpoint = Number(arg('endpoint', '1.2'))
const hangover = Number(arg('hangover', '0.4'))
const useVad = !process.argv.includes('--no-vad')
const registry = JSON.parse(readFileSync(join(root, 'src/main/asr/models.json'), 'utf8')) as ModelEntry[]
const model = registry.find((entry) => entry.id === modelId)
if (model === undefined) throw new Error(`Unknown model ${modelId}`)
if (!existsSync(join(root, 'models', model.dir))) throw new Error(`Model not installed: npm run fetch-models -- --only ${modelId}`)

const sentences = readFileSync(join(root, 'bench/sentences.txt'), 'utf8').split(/\r?\n/).filter((line) => line.trim().length > 0)
const recognizer = new sherpa.OnlineRecognizer(recognizerConfig(model, join(root, 'models'), Number(arg('threads', '2')), endpoint))
const CHUNK = SAMPLE_RATE / 10

const latencies: number[] = []
const trailing: number[] = []
const verbose = process.argv.includes('--verbose')
let errors = 0
let words = 0
let splits = 0
// One recogniser and one voice detector for the whole run, with silence between sentences, like a real call.
const gapMs = Number(arg('gap', '3000'))
const vad = useVad ? new sherpa.Vad(vadConfig(join(root, 'models'), hangover), 30) : null
let audioMs = 0
let current: AsrEvent[] = []
const finalsAt: number[] = []
const source = new SourceRecognizer(recognizer, 'them', (event) => {
  current.push(event)
  if (event.kind === 'final') finalsAt.push(audioMs)
}, () => performance.now(), vad)
let lastCompute = 0
const feed = (samples: Float32Array): void => {
  const start = performance.now()
  source.accept(samples)
  audioMs += (samples.length / SAMPLE_RATE) * 1000
  lastCompute = performance.now() - start
}
const silence = (ms: number): void => {
  for (let i = 0; i < ms / 100; i++) feed(new Float32Array(CHUNK))
}
silence(gapMs)
sentences.forEach((reference, index) => {
  const speech = sherpa.readWave(join(root, 'bench/audio', `${String(index).padStart(2, '0')}.wav`)).samples
  current = []
  const finalsBefore = finalsAt.length
  // The files end with trailing silence: measure where the voice actually stops.
  let lastLoud = speech.length - 1
  while (lastLoud > 0 && Math.abs(speech[lastLoud] ?? 0) < 0.02) lastLoud--
  trailing.push(((speech.length - 1 - lastLoud) / SAMPLE_RATE) * 1000)
  const startMs = audioMs
  for (let offset = 0; offset < speech.length; offset += CHUNK) feed(speech.subarray(offset, offset + CHUNK))
  const speechEndMs = startMs + (lastLoud / SAMPLE_RATE) * 1000
  let waited = 0
  while (finalsAt.length === finalsBefore && waited < 4000) {
    feed(new Float32Array(CHUNK))
    waited += 100
  }
  const at = finalsAt[finalsAt.length - 1]
  if (finalsAt.length === finalsBefore || at === undefined) {
    console.log(`#${index}: no final after 4 s of silence`)
  } else {
    latencies.push(at - speechEndMs + lastCompute)
  }
  const finals = current.filter((event) => event.kind === 'final')
  if (finals.length > 1) splits++
  const ref = normalizeForWer(reference)
  const hyp = normalizeForWer(finals.map((event) => event.text).join(' '))
  errors += wordErrors(ref, hyp)
  words += ref.length
  if (verbose && (ref.join(' ') !== hyp.join(' ') || finals.length > 1)) console.log(`  REF ${ref.join(' ')}
  HYP ${finals.map((event) => `[${event.text}]`).join(' ')}`)
  silence(gapMs)
})

const sorted = [...latencies].sort((a, b) => a - b)
const pct = (p: number): number => sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)] ?? NaN
const p95 = pct(95)
console.log(`model ${modelId}, ${useVad ? `VAD hangover ${hangover}s` : 'no VAD'}, fallback endpoint ${endpoint}s, ${latencies.length}/${sentences.length} finals`)
console.log(`voice-to-transcript ms: p50 ${pct(50).toFixed(0)}  p95 ${p95.toFixed(0)}  max ${(sorted.at(-1) ?? NaN).toFixed(0)}`)
console.log(`file trailing silence ms: median ${[...trailing].sort((a, b) => a - b)[Math.floor(trailing.length / 2)]?.toFixed(0) ?? '?'}`)
console.log(`sentences split into several finals: ${splits}`)
console.log(`WER ${((errors / Math.max(1, words)) * 100).toFixed(1)}%`)
const pass = latencies.length >= 20 && p95 <= 1200 && splits === 0
console.log(`G6 (p95 <= 1200 ms over >= 20 utterances, no split sentences): ${pass ? 'PASS' : 'FAIL'}`)
process.exitCode = pass ? 0 : 1
process.on("exit", () => { const u = process.cpuUsage(); console.log(`cpu time ${((u.user + u.system) / 1e6).toFixed(1)} s, wall ${(process.uptime()).toFixed(1)} s`) })
