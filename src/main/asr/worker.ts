/**
 * Speech-recognition worker, run as an Electron utilityProcess so a model crash
 * or a slow decode never blocks or kills the main process. One recogniser model,
 * one stream and one voice detector per side of the call.
 */
import { appendFileSync, existsSync, mkdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { performance } from 'node:perf_hooks'
import { z } from 'zod'
import { SourceSchema, type Source } from '../../shared/transcript'
import { VAD_HANGOVER_S, recognizerConfig, vadConfig } from './config'
import { SourceRecognizer, type AsrEvent } from './engine'
import type { SherpaModule, SherpaVadModule } from './sherpa-types'

const InitSchema = z.object({
  type: z.literal('init'),
  modelsRoot: z.string(),
  model: z.object({ id: z.string(), dir: z.string(), featureDim: z.number().int() }),
  threads: z.number().int().min(1).max(8)
})
const AudioSchema = z.object({
  type: z.literal('audio'),
  source: SourceSchema,
  samples: z.instanceof(Float32Array).refine((samples) => samples.length <= 16_000)
})
const FlushSchema = z.object({ type: z.literal('flush'), source: SourceSchema })
const MessageSchema = z.discriminatedUnion('type', [InitSchema, AudioSchema, FlushSchema])

export type WorkerOut =
  | { type: 'ready'; model: string; loadMs: number }
  | { type: 'event'; event: AsrEvent }
  | { type: 'error'; code: 'missing-model' | 'load-failed' | 'decode-failed'; message: string }

const port = process.parentPort
const post = (message: WorkerOut): void => {
  port.postMessage(message)
}

let sources: Record<Source, SourceRecognizer> | null = null

/** Diagnostics: with GLIMPSE_AUDIO_DUMP=<folder>, the exact audio each source receives is appended as raw float32. */
const dumpDir = process.env['GLIMPSE_AUDIO_DUMP']
if (dumpDir !== undefined && dumpDir.length > 0) mkdirSync(dumpDir, { recursive: true })
function dump(source: Source, samples: Float32Array): void {
  if (dumpDir === undefined || dumpDir.length === 0) return
  appendFileSync(join(dumpDir, `${source}.f32`), Buffer.from(samples.buffer, samples.byteOffset, samples.byteLength))
  appendFileSync(join(dumpDir, `${source}.times`), `${String(Date.now())}\n`)
}

function init(message: z.infer<typeof InitSchema>): void {
  const modelDir = join(message.modelsRoot, message.model.dir)
  const vadFile = join(message.modelsRoot, 'silero-vad', 'silero_vad.onnx')
  if (!existsSync(modelDir) || !existsSync(vadFile)) {
    post({ type: 'error', code: 'missing-model', message: `Speech model not installed. Run: npm run fetch-models -- --only ${message.model.id},silero-vad` })
    return
  }
  try {
    const started = performance.now()
    const sherpa = createRequire(__filename)('sherpa-onnx-node') as SherpaModule & SherpaVadModule
    const recognizer = new sherpa.OnlineRecognizer(recognizerConfig(message.model, message.modelsRoot, message.threads))
    const emit = (event: AsrEvent): void => {
      post({ type: 'event', event })
    }
    const make = (source: Source): SourceRecognizer =>
      new SourceRecognizer(recognizer, source, emit, () => performance.now(), new sherpa.Vad(vadConfig(message.modelsRoot), 30), VAD_HANGOVER_S * 1000)
    sources = { them: make('them'), you: make('you') }
    post({ type: 'ready', model: message.model.id, loadMs: Math.round(performance.now() - started) })
  } catch (error) {
    post({ type: 'error', code: 'load-failed', message: error instanceof Error ? error.message : String(error) })
  }
}

port.on('message', (event) => {
  const parsed = MessageSchema.safeParse(event.data)
  if (!parsed.success) return
  const message = parsed.data
  if (message.type === 'init') {
    init(message)
    return
  }
  if (sources === null) return
  try {
    if (message.type === 'audio') {
      dump(message.source, message.samples)
      sources[message.source].accept(message.samples)
    }
    else sources[message.source].finish()
  } catch (error) {
    post({ type: 'error', code: 'decode-failed', message: error instanceof Error ? error.message : String(error) })
  }
})
