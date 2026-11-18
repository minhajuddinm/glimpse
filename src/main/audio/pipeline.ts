import { join } from 'node:path'
import { BrowserWindow, desktopCapturer, ipcMain, session, type IpcMainEvent, type WebContents } from 'electron'
import { z } from 'zod'
import type { CaptureControl } from '../../shared/ipc'
import type { Settings } from '../../shared/settings'
import {
  SourceSchema,
  type AudioDevice,
  type AudioLevels,
  type AudioStatus,
  type Source,
  type SourceStatus,
  type TranscriptSnapshot
} from '../../shared/transcript'
import type { AsrEvent } from '../asr/engine'
import modelRegistry from '../asr/models.json'
import { AsrService } from '../asr/service'
import { SECURE_WEB_PREFERENCES, devRendererUrl, rendererFileUrl } from '../security'
import { TranscriptBuffer } from '../transcript/buffer'

const ChunkSchema = z.object({
  source: SourceSchema,
  samples: z.instanceof(Float32Array).refine((samples) => samples.length > 0 && samples.length <= 16_000),
  rms: z.number().min(0).max(10)
})

const OFF: SourceStatus = { state: 'off', label: '', message: '' }

export interface PipelineOptions {
  readonly appRoot: string
  readonly getSettings: () => Settings
  readonly isPanic: () => boolean
  readonly broadcastStatus: (status: AudioStatus) => void
  readonly broadcastLevels: (levels: AudioLevels) => void
  readonly broadcastTranscript: (snapshot: TranscriptSnapshot) => void
}

/**
 * Pillar B in the main process: owns the hidden capture page, accepts its audio
 * (and nothing from any other page), sends it to the speech worker, and turns
 * recognised text into the speaker-labelled transcript.
 */
export class AudioPipeline {
  private window: BrowserWindow | null = null
  private sources: Record<Source, SourceStatus> = { them: { ...OFF, label: 'System audio' }, you: { ...OFF, label: 'Microphone' } }
  private devices: AudioDevice[] = []
  private levels: AudioLevels = { them: 0, you: 0 }
  private levelTimer: ReturnType<typeof setInterval> | null = null
  private retryCount = 0
  private lastControl = ''
  readonly transcript = new TranscriptBuffer()
  readonly asr: AsrService

  constructor(private readonly options: PipelineOptions) {
    this.asr = new AsrService({
      modelsRoot: join(options.appRoot, 'models'),
      registry: modelRegistry,
      workerPath: join(__dirname, 'asrWorker.js'),
      getModelId: () => options.getSettings().asrModel,
      onEvent: (event) => {
        this.onAsrEvent(event)
      },
      onState: () => {
        this.emitStatus()
      }
    })
  }

  status(): AudioStatus {
    return { them: this.sources.them, you: this.sources.you, asr: this.asr.status(), latency: this.transcript.latencyStats() }
  }

  deviceList(): AudioDevice[] {
    return this.devices
  }

  /** What the capture page should be doing right now, from settings and panic state. */
  control(): CaptureControl {
    const settings = this.options.getSettings()
    return {
      micDeviceId: settings.micDeviceId,
      micEnabled: !settings.micMuted,
      loopbackEnabled: !settings.loopbackMuted,
      paused: this.options.isPanic(),
      retry: this.retryCount
    }
  }

  async start(): Promise<void> {
    this.installSessionHandlers()
    ipcMain.on('audio:chunk', this.onChunk)
    this.asr.start()
    await this.createWindow()
    this.levelTimer = setInterval(() => {
      this.options.broadcastLevels(this.levels)
      this.levels = { them: this.levels.them * 0.5, you: this.levels.you * 0.5 }
    }, 100)
  }

  /** Re-applies settings or panic changes to the capture page (no-op if nothing changed). */
  sync(): void {
    const control = this.control()
    const key = JSON.stringify(control)
    if (key === this.lastControl) return
    this.lastControl = key
    if (control.paused || !control.micEnabled) this.asr.flush('you')
    if (control.paused || !control.loopbackEnabled) this.asr.flush('them')
    this.window?.webContents.send('capture:control', control)
  }

  /** The Retry button: restart both sources and, if it gave up, the speech engine. */
  retry(): void {
    this.retryCount++
    const asr = this.asr.status().state
    if (asr === 'paused' || asr === 'error' || asr === 'missing-model') this.asr.retry()
    this.sync()
  }

  /** Called by the capture page with its current state and device list. */
  report(them: SourceStatus, you: SourceStatus, devices: AudioDevice[]): void {
    this.sources = { them, you }
    this.devices = devices
    this.emitStatus()
  }

  isCaptureSender(contents: WebContents): boolean {
    return this.window !== null && !this.window.isDestroyed() && contents.id === this.window.webContents.id
  }

  stop(): void {
    ipcMain.removeListener('audio:chunk', this.onChunk)
    if (this.levelTimer !== null) clearInterval(this.levelTimer)
    this.levelTimer = null
    this.asr.stop()
    this.window?.destroy()
    this.window = null
  }

  private readonly onChunk = (event: IpcMainEvent, raw: unknown): void => {
    if (!this.isCaptureSender(event.sender)) return
    const parsed = ChunkSchema.safeParse(raw)
    if (!parsed.success) return
    const { source, samples, rms } = parsed.data
    const control = this.control()
    if (control.paused || (source === 'you' && !control.micEnabled) || (source === 'them' && !control.loopbackEnabled)) return
    this.levels = { ...this.levels, [source]: Math.max(this.levels[source], rms) }
    this.asr.send(source, samples)
  }

  private onAsrEvent(event: AsrEvent): void {
    if (event.kind === 'partial') {
      this.transcript.setPartial(event.source, event.text)
    } else {
      this.transcript.addFinal(event.source, event.text, event.latencyMs)
      this.emitStatus()
    }
    this.options.broadcastTranscript(this.transcript.snapshot())
  }

  private emitStatus(): void {
    this.options.broadcastStatus(this.status())
  }

  private installSessionHandlers(): void {
    const ses = session.defaultSession
    // Only the hidden capture page may use the microphone or system audio.
    ses.setPermissionRequestHandler((contents, permission, callback) => {
      callback((permission === 'media' || permission === 'display-capture') && this.isCaptureSender(contents))
    })
    ses.setPermissionCheckHandler((contents, permission) => {
      return contents !== null && (permission === 'media' || permission === 'display-capture') && this.isCaptureSender(contents)
    })
    // getDisplayMedia from the capture page gets the system-audio mix ("loopback"); nothing else is offered.
    ses.setDisplayMediaRequestHandler((request, callback) => {
      const fromCapture = request.frame !== null && this.window !== null && request.frame.url === this.window.webContents.getURL()
      if (!fromCapture) {
        callback({})
        return
      }
      void desktopCapturer.getSources({ types: ['screen'] }).then(
        (screens) => {
          const screen = screens[0]
          if (screen === undefined) callback({})
          else callback({ video: screen, audio: 'loopback' })
        },
        () => {
          callback({})
        }
      )
    })
  }

  private async createWindow(): Promise<void> {
    const win = new BrowserWindow({
      show: false,
      width: 320,
      height: 200,
      skipTaskbar: true,
      title: 'Glimpse capture',
      webPreferences: {
        ...SECURE_WEB_PREFERENCES,
        preload: join(__dirname, '../preload/index.js'),
        // A hidden page must keep processing audio at full rate.
        backgroundThrottling: false,
        autoplayPolicy: 'no-user-gesture-required'
      }
    })
    this.window = win
    win.on('closed', () => {
      this.window = null
    })
    win.webContents.on('render-process-gone', () => {
      // Recreate the capture page if its renderer crashes.
      win.destroy()
      this.window = null
      setTimeout(() => {
        void this.createWindow()
      }, 1000)
    })
    const dev = devRendererUrl()
    await (dev !== null ? win.loadURL(`${dev}/capture.html`) : win.loadURL(rendererFileUrl('capture.html')))
    this.lastControl = ''
  }
}
