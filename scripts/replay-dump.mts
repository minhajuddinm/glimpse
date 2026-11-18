/**
 * Replays an audio dump (GLIMPSE_AUDIO_DUMP) through the live recognition engine and
 * prints, per 100 ms chunk, the level, the voice detector's state and the text.
 *   node scripts/replay-dump.mts <dump-folder> [them|you]
 */
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join, resolve } from 'node:path'
import { SAMPLE_RATE, SourceRecognizer, type AsrEvent } from '../src/main/asr/engine.ts'
import { recognizerConfig, vadConfig, type ModelEntry } from '../src/main/asr/config.ts'
import type { SherpaModule, SherpaVadModule, VoiceDetector } from '../src/main/asr/sherpa-types'

const root = resolve(import.meta.dirname, '..')
const dir = process.argv[2] ?? ''
const source = process.argv[3] === 'you' ? 'you' : 'them'
const sherpa = createRequire(import.meta.url)('sherpa-onnx-node') as SherpaModule & SherpaVadModule
const registry = JSON.parse(readFileSync(join(root, 'src/main/asr/models.json'), 'utf8')) as ModelEntry[]
const model = registry.find((entry) => entry.id === 'kroko-en')
if (model === undefined) throw new Error('kroko-en missing from registry')
const raw = readFileSync(join(dir, `${source}.f32`))
const audio = new Float32Array(raw.buffer, raw.byteOffset, raw.length / 4)

const recognizer = new sherpa.OnlineRecognizer(recognizerConfig(model, join(root, 'models'), 2))
const vad = new sherpa.Vad(vadConfig(join(root, 'models')), 30)
// Wrap the detector to log its state after each chunk.
const vadState = { detected: false }
const spy: VoiceDetector = {
  acceptWaveform: (samples) => { vad.acceptWaveform(samples) },
  isDetected: () => (vadState.detected = vad.isDetected()),
  isEmpty: () => vad.isEmpty(),
  pop: () => { vad.pop() }
}
const events: string[] = []
const engine = new SourceRecognizer(recognizer, source, (event: AsrEvent) => {
  events.push(event.kind === 'final' ? `FINAL "${event.text}"` : `partial "${event.text}"`)
}, () => performance.now(), spy)

const CHUNK = SAMPLE_RATE / 10
for (let c = 0; c * CHUNK < audio.length; c++) {
  const chunk = audio.subarray(c * CHUNK, (c + 1) * CHUNK)
  let energy = 0
  for (const sample of chunk) energy += sample * sample
  const db = 10 * Math.log10(energy / chunk.length + 1e-12)
  events.splice(0)
  engine.accept(chunk)
  if (db > -60 || events.length > 0) console.log(`${String(c).padStart(4)} ${db.toFixed(0).padStart(4)} dB vad=${vadState.detected ? 'SPEECH' : '  -   '} ${events.join(' | ')}`)
}
