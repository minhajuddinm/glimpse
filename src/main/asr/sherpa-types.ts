/**
 * Types for the parts of `sherpa-onnx-node` that Glimpse uses. The package ships
 * no declarations, so this is the single typed view of it; load the package with
 * `createRequire(...)('sherpa-onnx-node') as SherpaModule`.
 */
export interface TransducerFiles {
  readonly encoder: string
  readonly decoder: string
  readonly joiner: string
}

export interface OnlineRecognizerConfig {
  readonly featConfig: { readonly sampleRate: number; readonly featureDim: number }
  readonly modelConfig: {
    readonly transducer: TransducerFiles
    readonly tokens: string
    readonly numThreads: number
    readonly provider: 'cpu'
    readonly debug: 0 | 1
  }
  readonly decodingMethod?: 'greedy_search' | 'modified_beam_search'
  readonly enableEndpoint?: boolean
}

export interface OnlineResult {
  readonly text: string
  readonly tokens: readonly string[]
  readonly timestamps: readonly number[]
}

export interface WaveInput {
  readonly sampleRate: number
  readonly samples: Float32Array
}

export interface OnlineStream {
  acceptWaveform(input: WaveInput): void
  inputFinished(): void
}

export interface OnlineRecognizer {
  createStream(): OnlineStream
  isReady(stream: OnlineStream): boolean
  decode(stream: OnlineStream): void
  getResult(stream: OnlineStream): OnlineResult
  isEndpoint(stream: OnlineStream): boolean
  reset(stream: OnlineStream): void
}

export interface SherpaModule {
  OnlineRecognizer: new (config: OnlineRecognizerConfig) => OnlineRecognizer
  readWave(filename: string): WaveInput
  readonly version: string
}
