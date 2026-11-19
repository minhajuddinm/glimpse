import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { utilityProcess, type UtilityProcess } from 'electron'
import { z } from 'zod'
import { CircuitBreaker, backoffDelay } from '../../shared/backoff'
import type { AudioStatus, Source } from '../../shared/transcript'
import type { AsrEvent } from './engine'

export type AsrState = AudioStatus['asr']

const RegistrySchema = z.array(z.object({ id: z.string(), dir: z.string(), featureDim: z.number().int() }))

const WorkerOutSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('ready'), model: z.string(), loadMs: z.number() }),
  z.object({
    type: z.literal('event'),
    event: z.discriminatedUnion('kind', [
      z.object({ kind: z.literal('partial'), source: z.enum(['them', 'you']), text: z.string() }),
      z.object({ kind: z.literal('final'), source: z.enum(['them', 'you']), text: z.string(), latencyMs: z.number() })
    ])
  }),
  z.object({ type: z.literal('error'), code: z.string(), message: z.string() })
])

export interface AsrServiceOptions {
  readonly modelsRoot: string
  /** Contents of src/main/asr/models.json (bundled, so it also works in an installed build). */
  readonly registry: unknown
  readonly workerPath: string
  readonly getModelId: () => string
  readonly onEvent: (event: AsrEvent) => void
  readonly onState: (state: AsrState) => void
}

/**
 * Runs the speech worker and keeps it alive: restarts with backoff and jitter
 * after a crash, and stops retrying (circuit open) after 5 consecutive failures
 * until retry() is called.
 */
export class AsrService {
  private child: UtilityProcess | null = null
  private ready = false
  private stopping = false
  private timer: ReturnType<typeof setTimeout> | null = null
  private readonly breaker = new CircuitBreaker(5)
  private state: AsrState = { state: 'off', model: '', message: '' }

  constructor(private readonly options: AsrServiceOptions) {}

  status(): AsrState {
    return this.state
  }

  get isReady(): boolean {
    return this.ready
  }

  start(): void {
    this.stopping = false
    if (this.child !== null) return
    const modelId = this.options.getModelId()
    const registry = RegistrySchema.parse(this.options.registry)
    const model = registry.find((entry) => entry.id === modelId)
    if (model === undefined) {
      this.setState({ state: 'error', model: modelId, message: `Unknown speech model ${modelId}.` })
      return
    }
    if (!existsSync(join(this.options.modelsRoot, model.dir)) || !existsSync(join(this.options.modelsRoot, 'silero-vad'))) {
      this.setState({
        state: 'missing-model',
        model: modelId,
        message: `Speech model not installed. In the Glimpse folder run: npm run fetch-models -- --only ${modelId},silero-vad`
      })
      return
    }
    this.setState({ state: 'loading', model: modelId, message: 'Loading the speech model…' })
    const child = utilityProcess.fork(this.options.workerPath, [], { serviceName: 'Glimpse speech', env: { ...process.env } })
    this.child = child
    child.on('message', (raw: unknown) => {
      const parsed = WorkerOutSchema.safeParse(raw)
      if (!parsed.success) return
      const message = parsed.data
      if (message.type === 'ready') {
        this.ready = true
        this.breaker.recordSuccess()
        this.setState({ state: 'ready', model: message.model, message: `Ready (loaded in ${message.loadMs} ms).` })
      } else if (message.type === 'event') {
        this.options.onEvent(message.event)
      } else if (message.code === 'missing-model') {
        this.setState({ state: 'missing-model', model: modelId, message: message.message })
        this.stop()
      } else {
        this.setState({ state: 'error', model: modelId, message: message.message })
      }
    })
    child.on('exit', (code) => {
      this.child = null
      this.ready = false
      if (this.stopping || this.state.state === 'missing-model') return
      this.breaker.recordFailure()
      if (this.breaker.open) {
        this.setState({ state: 'paused', model: modelId, message: `The speech engine stopped ${this.breaker.consecutiveFailures} times in a row (last exit code ${code}). Press Retry.` })
        return
      }
      const delay = backoffDelay(this.breaker.consecutiveFailures)
      this.setState({ state: 'restarting', model: modelId, message: `The speech engine stopped (code ${code}); restarting in ${Math.round(delay / 100) / 10} s.` })
      this.timer = setTimeout(() => {
        this.timer = null
        this.start()
      }, delay)
    })
    child.postMessage({ type: 'init', modelsRoot: this.options.modelsRoot, model, threads: 1 })
  }

  send(source: Source, samples: Float32Array): void {
    if (this.ready) this.child?.postMessage({ type: 'audio', source, samples })
  }

  flush(source: Source): void {
    if (this.ready) this.child?.postMessage({ type: 'flush', source })
  }

  /** Clears the circuit breaker and starts again (the Retry button, or a model change). */
  retry(): void {
    this.breaker.reset()
    this.stop()
    this.start()
  }

  stop(): void {
    this.stopping = true
    if (this.timer !== null) clearTimeout(this.timer)
    this.timer = null
    this.ready = false
    this.child?.kill()
    this.child = null
    if (this.state.state !== 'missing-model' && this.state.state !== 'paused') this.setState({ ...this.state, state: 'off', message: 'Stopped.' })
  }

  private setState(state: AsrState): void {
    this.state = state
    this.options.onState(state)
  }
}
