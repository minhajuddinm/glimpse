/**
 * Benchmarks streaming speech-recognition models on bench/audio (npm run bench:audio makes it).
 *
 *   npm run bench:asr                              every installed model, 2 threads
 *   npm run bench:asr -- --models kroko-en,nemo-fc-480ms
 *   npm run bench:asr -- --threads 4 --snr 10
 *
 * Audio is fed in 100 ms chunks followed by 0.4 s of silence (the VAD hangover),
 * as the live pipeline will do. Chunk compute times are measured with the CPU warm;
 * latency is derived from them rather than from wall-clock pacing, which is valid
 * whenever the real-time factor stays well below 1.
 */
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join, resolve } from 'node:path'
import { performance } from 'node:perf_hooks'
import { z } from 'zod'
import type { OnlineRecognizer, SherpaModule } from '../src/main/asr/sherpa-types'
import { normalizeForWer, wordErrors } from '../src/shared/wer.ts'

const root = resolve(import.meta.dirname, '..')
const sherpa = createRequire(import.meta.url)('sherpa-onnx-node') as SherpaModule

const ModelSchema = z.object({
  id: z.string(),
  dir: z.string(),
  featureDim: z.number().int(),
  family: z.string(),
  bytes: z.number()
})
const registry = z.array(ModelSchema).parse(JSON.parse(readFileSync(join(root, 'src/main/asr/models.json'), 'utf8')))

const SAMPLE_RATE = 16000
const HANGOVER_MS = 400
/** Speech is preceded by this much silence, like the live pipeline's 250 ms pre-roll. */
const LEAD_MS = Number(arg('lead-ms', '250'))
/** Extra silence fed instantly after the hangover. It costs compute but no waiting. */
const PAD_MS = Number(arg('pad-ms', '1000'))
const SENTENCES = readFileSync(join(root, 'bench/sentences.txt'), 'utf8')
  .split(/\r?\n/)
  .filter((line) => line.trim().length > 0)

function arg(name: string, fallback: string): string {
  const index = process.argv.indexOf(`--${name}`)
  return index >= 0 ? (process.argv[index + 1] ?? fallback) : fallback
}

function pick(dir: string, prefix: string): string {
  const matches = readdirSync(dir).filter((name) => name.startsWith(prefix) && name.endsWith('.onnx'))
  const chosen = matches.find((name) => name.includes('.int8.')) ?? matches[0]
  if (chosen === undefined) throw new Error(`No ${prefix}*.onnx in ${dir}`)
  return join(dir, chosen)
}

/** Deterministic noise so every model hears the same audio. */
function mulberry32(seed: number): () => number {
  let a = seed
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function addNoise(samples: Float32Array, snrDb: number, seed: number): Float32Array {
  let energy = 0
  for (const sample of samples) energy += sample * sample
  const rms = Math.sqrt(energy / samples.length)
  const sigma = rms / 10 ** (snrDb / 20)
  const random = mulberry32(seed)
  const out = new Float32Array(samples.length)
  for (let i = 0; i < samples.length; i++) {
    // Box-Muller: Gaussian noise from two uniform draws.
    const gaussian = Math.sqrt(-2 * Math.log(random() + 1e-12)) * Math.cos(2 * Math.PI * random())
    out[i] = (samples[i] ?? 0) + sigma * gaussian
  }
  return out
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)] ?? 0
}

interface Utterance {
  readonly samples: Float32Array
  readonly sampleRate: number
  readonly reference: string
}

interface UtteranceRun {
  readonly text: string
  readonly computeMs: number
  readonly audioMs: number
  readonly chunkMs: number[]
  /** Compute on the critical path after end-of-speech: the instant padding plus finishing the stream. */
  readonly finalMs: number
}

function runUtterance(recognizer: OnlineRecognizer, utterance: Utterance): UtteranceRun {
  const rate = utterance.sampleRate
  const chunk = rate / 10
  const silence = (ms: number): Float32Array => new Float32Array(Math.round((rate * ms) / 1000))
  const lead = silence(LEAD_MS)
  const samples = new Float32Array(lead.length + utterance.samples.length)
  samples.set(utterance.samples, lead.length)

  const stream = recognizer.createStream()
  const chunkMs: number[] = []
  const feed = (part: Float32Array): number => {
    const start = performance.now()
    stream.acceptWaveform({ sampleRate: rate, samples: part })
    while (recognizer.isReady(stream)) recognizer.decode(stream)
    return performance.now() - start
  }
  for (let offset = 0; offset < samples.length; offset += chunk) chunkMs.push(feed(samples.subarray(offset, offset + chunk)))
  // The real-time hangover: compute here overlaps the wait, so it is not part of the latency.
  const tail = silence(HANGOVER_MS)
  for (let offset = 0; offset < tail.length; offset += chunk) chunkMs.push(feed(tail.subarray(offset, offset + chunk)))
  // Instant padding after end-of-speech: this compute is on the critical path.
  const pad = silence(PAD_MS)
  let padMs = 0
  for (let offset = 0; offset < pad.length; offset += chunk) {
    const took = feed(pad.subarray(offset, offset + chunk))
    chunkMs.push(took)
    padMs += took
  }
  const finishStart = performance.now()
  stream.inputFinished()
  while (recognizer.isReady(stream)) recognizer.decode(stream)
  const text = recognizer.getResult(stream).text
  const finishMs = performance.now() - finishStart
  const computeMs = chunkMs.reduce((sum, value) => sum + value, 0) + finishMs
  return { text, computeMs, audioMs: ((samples.length + tail.length + pad.length) / rate) * 1000, chunkMs, finalMs: padMs + finishMs }
}

interface ConditionResult {
  readonly wer: number
  readonly rtf: number
  readonly chunkP95: number
  readonly finalP50: number
  readonly finalP95: number
  readonly mismatches: { reference: string; hypothesis: string }[]
}

function runCondition(recognizer: OnlineRecognizer, utterances: readonly Utterance[]): ConditionResult {
  let errors = 0
  let words = 0
  let compute = 0
  let duration = 0
  const chunkMs: number[] = []
  const finals: number[] = []
  const mismatches: { reference: string; hypothesis: string }[] = []
  for (const utterance of utterances) {
    const run = runUtterance(recognizer, utterance)
    const reference = normalizeForWer(utterance.reference)
    const hypothesis = normalizeForWer(run.text)
    errors += wordErrors(reference, hypothesis)
    words += reference.length
    compute += run.computeMs
    duration += run.audioMs
    chunkMs.push(...run.chunkMs)
    finals.push(run.finalMs)
    if (reference.join(' ') !== hypothesis.join(' ')) mismatches.push({ reference: reference.join(' '), hypothesis: hypothesis.join(' ') })
  }
  return {
    wer: words === 0 ? 0 : errors / words,
    rtf: duration === 0 ? 0 : compute / duration,
    chunkP95: percentile(chunkMs, 95),
    finalP50: percentile(finals, 50),
    finalP95: percentile(finals, 95),
    mismatches
  }
}

/**
 * Real human recordings (one at 8 kHz, like a phone line) that ship with the model
 * packages. They are copied to bench/real once, with their transcripts.
 */
function loadRealRecordings(): Utterance[] {
  const realDir = join(root, 'bench/real')
  if (!existsSync(join(realDir, 'trans.txt'))) {
    const source = readdirSync(join(root, 'models'))
      .map((name) => join(root, 'models', name, 'test_wavs'))
      .find((dir) => existsSync(join(dir, 'trans.txt')) && existsSync(join(dir, '8k.wav')))
    if (source === undefined) return []
    mkdirSync(realDir, { recursive: true })
    for (const name of ['0.wav', '1.wav', '8k.wav', 'trans.txt']) copyFileSync(join(source, name), join(realDir, name))
  }
  const utterances: Utterance[] = []
  for (const line of readFileSync(join(realDir, 'trans.txt'), 'utf8').split(/\r?\n/)) {
    const match = /^(\S+\.wav)\s+(.+)$/.exec(line.trim())
    if (match?.[1] === undefined || match[2] === undefined) continue
    const wave = sherpa.readWave(join(realDir, match[1]))
    utterances.push({ samples: wave.samples, sampleRate: wave.sampleRate, reference: match[2] })
  }
  return utterances
}

function main(): void {
  const threads = Number(arg('threads', '2'))
  const snr = Number(arg('snr', '15'))
  const wanted = arg('models', '').split(',').filter((id) => id.length > 0)
  const audioDir = join(root, 'bench/audio')
  if (!existsSync(audioDir)) throw new Error('bench/audio is missing. Run: npm run bench:audio')
  const clean: Utterance[] = SENTENCES.map((reference, index) => ({
    samples: sherpa.readWave(join(audioDir, `${String(index).padStart(2, '0')}.wav`)).samples,
    sampleRate: SAMPLE_RATE,
    reference
  }))
  const noisy = clean.map((utterance, index) => ({ ...utterance, samples: addNoise(utterance.samples, snr, 1000 + index) }))
  const real = loadRealRecordings()
  const audioSeconds = clean.reduce((sum, utterance) => sum + utterance.samples.length, 0) / SAMPLE_RATE

  console.log(
    `sherpa-onnx ${sherpa.version}, ${clean.length} synthetic + ${real.length} real utterances, ${audioSeconds.toFixed(0)} s of synthetic audio, ${threads} thread(s), noise ${snr} dB SNR, lead ${LEAD_MS} ms, pad ${PAD_MS} ms`
  )
  const rows: Record<string, unknown>[] = []
  for (const model of registry) {
    if (model.family === 'vad' || model.family === 'embedding' || (wanted.length > 0 && !wanted.includes(model.id))) continue
    const dir = join(root, 'models', model.dir)
    if (!existsSync(dir)) {
      console.log(`- ${model.id}: not installed (npm run fetch-models -- --only ${model.id})`)
      continue
    }
    const loadStart = performance.now()
    const recognizer = new sherpa.OnlineRecognizer({
      featConfig: { sampleRate: SAMPLE_RATE, featureDim: model.featureDim },
      modelConfig: {
        transducer: { encoder: pick(dir, 'encoder'), decoder: pick(dir, 'decoder'), joiner: pick(dir, 'joiner') },
        tokens: join(dir, 'tokens.txt'),
        numThreads: threads,
        provider: 'cpu',
        debug: 0
      }
    })
    const loadMs = performance.now() - loadStart
    const first = clean[0]
    if (first !== undefined) runUtterance(recognizer, first) // warm-up
    const cleanResult = runCondition(recognizer, clean)
    const noisyResult = runCondition(recognizer, noisy)
    const realResult = runCondition(recognizer, real)
    const row = {
      model: model.id,
      sizeMB: Math.round(model.bytes / 1048576),
      loadMs: Math.round(loadMs),
      rtf: Number(cleanResult.rtf.toFixed(3)),
      chunkP95ms: Math.round(cleanResult.chunkP95),
      finalP50ms: Number(cleanResult.finalP50.toFixed(1)),
      finalP95ms: Number(cleanResult.finalP95.toFixed(1)),
      voiceToTextP95ms: Math.round(HANGOVER_MS + 100 + cleanResult.finalP95),
      werClean: Number((cleanResult.wer * 100).toFixed(1)),
      werNoisy: Number((noisyResult.wer * 100).toFixed(1)),
      werReal: real.length === 0 ? null : Number((realResult.wer * 100).toFixed(1))
    }
    rows.push({ ...row, cleanMismatches: cleanResult.mismatches.slice(0, 5), realMismatches: realResult.mismatches })
    console.log(JSON.stringify(row))
  }
  const summary = rows.map((row) => Object.fromEntries(Object.entries(row).filter(([key]) => !key.endsWith('Mismatches'))))
  console.table(summary)
  const outDir = join(root, 'bench/results')
  mkdirSync(outDir, { recursive: true })
  const file = join(outDir, `asr-${new Date().toISOString().replace(/[:.]/g, '-')}.json`)
  writeFileSync(file, JSON.stringify({ threads, snr, leadMs: LEAD_MS, padMs: PAD_MS, audioSeconds, rows }, null, 2))
  console.log(`Saved ${file}`)
}

main()
