import { readdirSync } from 'node:fs'
import { join } from 'node:path'
import type { OnlineRecognizerConfig, VadConfig } from './sherpa-types'

export interface ModelEntry {
  readonly id: string
  readonly dir: string
  readonly featureDim: number
}

const SAMPLE_RATE = 16000

/** Fallback: the recogniser ends an utterance after this much trailing silence if the voice detector did not. */
export const ENDPOINT_SILENCE_S = 1.2

/** Silence (s) the voice detector waits before saying speech has ended: the hangover. */
export const VAD_HANGOVER_S = 0.4

export function vadConfig(modelsRoot: string, hangoverS: number = VAD_HANGOVER_S): VadConfig {
  return {
    sileroVad: {
      model: join(modelsRoot, 'silero-vad', 'silero_vad.onnx'),
      threshold: 0.5,
      minSpeechDuration: 0.25,
      minSilenceDuration: hangoverS,
      windowSize: 512
    },
    sampleRate: SAMPLE_RATE,
    numThreads: 1,
    provider: 'cpu',
    debug: 0
  }
}

function pick(dir: string, prefix: string): string {
  const matches = readdirSync(dir).filter((name) => name.startsWith(prefix) && name.endsWith('.onnx'))
  const chosen = matches.find((name) => name.includes('.int8.')) ?? matches[0]
  if (chosen === undefined) throw new Error(`No ${prefix}*.onnx in ${dir}`)
  return join(dir, chosen)
}

export function recognizerConfig(
  model: ModelEntry,
  modelsRoot: string,
  numThreads: number,
  endpointSilenceS: number = ENDPOINT_SILENCE_S
): OnlineRecognizerConfig {
  const dir = join(modelsRoot, model.dir)
  return {
    featConfig: { sampleRate: SAMPLE_RATE, featureDim: model.featureDim },
    modelConfig: {
      transducer: { encoder: pick(dir, 'encoder'), decoder: pick(dir, 'decoder'), joiner: pick(dir, 'joiner') },
      tokens: join(dir, 'tokens.txt'),
      numThreads,
      provider: 'cpu',
      debug: 0
    },
    enableEndpoint: true,
    // Rule 1 ("nothing recognised for N s") would cut the start of the next sentence after a long pause; the voice detector handles silence.
    rule1MinTrailingSilence: 3600,
    rule2MinTrailingSilence: endpointSilenceS,
    rule3MinUtteranceLength: 20
  }
}
