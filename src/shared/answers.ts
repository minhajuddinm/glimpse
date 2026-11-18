import { z } from 'zod'

export const AnswerKindSchema = z.enum(['answer', 'talking-points', 'fact-check', 'screen', 'elaborate'])
export type AnswerKind = z.infer<typeof AnswerKindSchema>

export const AnswerSchema = z.object({
  id: z.number().int(),
  kind: AnswerKindSchema,
  question: z.string(),
  text: z.string(),
  status: z.enum(['thinking', 'streaming', 'done', 'error', 'cancelled']),
  /** Where the content came from: a prepared answer in the notes, the model, or the model grounded in notes. */
  origin: z.enum(['notes', 'model', 'notes+model', 'none']),
  /** Notes files the answer drew on. */
  sources: z.array(z.string()),
  error: z.string().nullable(),
  /** Wall-clock times (ms): when the trigger happened, first visible text, completion. */
  askedAt: z.number(),
  firstTextAt: z.number().nullable(),
  doneAt: z.number().nullable(),
  model: z.string().nullable()
})
export type Answer = z.infer<typeof AnswerSchema>

export const AnswersSnapshotSchema = z.object({ answers: z.array(AnswerSchema) })
export type AnswersSnapshot = z.infer<typeof AnswersSnapshotSchema>

export const KeyStatusSchema = z.object({
  anthropic: z.boolean(),
  groq: z.boolean(),
  /** False when Windows cannot encrypt secrets (keys are then refused, never stored in plain text). */
  encryptionAvailable: z.boolean()
})
export type KeyStatus = z.infer<typeof KeyStatusSchema>

export const KbFileSchema = z.object({
  name: z.string(),
  chunks: z.number().int(),
  qaPairs: z.number().int(),
  error: z.string().nullable()
})
export type KbFile = z.infer<typeof KbFileSchema>

export const KbStatusSchema = z.object({
  folder: z.string(),
  state: z.enum(['idle', 'indexing', 'error']),
  files: z.array(KbFileSchema),
  chunks: z.number().int(),
  semantic: z.boolean(),
  lastIndexedAt: z.number().nullable(),
  message: z.string()
})
export type KbStatus = z.infer<typeof KbStatusSchema>

export const KbHitSchema = z.object({
  file: z.string(),
  kind: z.enum(['qa', 'text']),
  question: z.string().nullable(),
  text: z.string(),
  score: z.number(),
  similarity: z.number().nullable()
})
export type KbHit = z.infer<typeof KbHitSchema>
