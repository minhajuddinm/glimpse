import { z } from 'zod'

export const SourceSchema = z.enum(['them', 'you'])
export type Source = z.infer<typeof SourceSchema>

/** A finished utterance from one side of the call. */
export const SegmentSchema = z.object({
  id: z.number().int(),
  source: SourceSchema,
  text: z.string(),
  /** Wall-clock time (ms) the segment was finalised. */
  at: z.number(),
  /** Estimated speech-end → text latency, if known. */
  latencyMs: z.number().nullable()
})
export type Segment = z.infer<typeof SegmentSchema>

export const TranscriptSnapshotSchema = z.object({
  segments: z.array(SegmentSchema),
  partials: z.object({ them: z.string(), you: z.string() })
})
export type TranscriptSnapshot = z.infer<typeof TranscriptSnapshotSchema>

export const CaptureStateSchema = z.enum(['off', 'starting', 'live', 'muted', 'retrying', 'paused', 'error'])
export type CaptureState = z.infer<typeof CaptureStateSchema>

export const SourceStatusSchema = z.object({
  state: CaptureStateSchema,
  label: z.string(),
  message: z.string()
})
export type SourceStatus = z.infer<typeof SourceStatusSchema>

export const AudioStatusSchema = z.object({
  them: SourceStatusSchema,
  you: SourceStatusSchema,
  asr: z.object({
    state: z.enum(['off', 'loading', 'ready', 'restarting', 'paused', 'missing-model', 'error']),
    model: z.string(),
    message: z.string()
  }),
  latency: z.object({ p50: z.number().nullable(), p95: z.number().nullable(), samples: z.number().int() })
})
export type AudioStatus = z.infer<typeof AudioStatusSchema>

export const AudioLevelsSchema = z.object({ them: z.number(), you: z.number() })
export type AudioLevels = z.infer<typeof AudioLevelsSchema>

export const AudioDeviceSchema = z.object({ deviceId: z.string(), label: z.string() })
export type AudioDevice = z.infer<typeof AudioDeviceSchema>

export const CompanionInfoSchema = z.object({
  running: z.boolean(),
  urls: z.array(z.string()),
  qr: z.string().nullable(),
  message: z.string()
})
export type CompanionInfo = z.infer<typeof CompanionInfoSchema>
