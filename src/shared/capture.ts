import { z } from 'zod'

/** How the OS was asked to exclude the overlay from capture, as read back from Windows. */
export const ProtectionMethodSchema = z.enum(['exclude-from-capture', 'monitor-only', 'none', 'unknown'])
export type ProtectionMethod = z.infer<typeof ProtectionMethodSchema>

export const ProtectionStatusSchema = z.object({
  requested: z.boolean(),
  method: ProtectionMethodSchema,
  /** Raw value of GetWindowDisplayAffinity, or null if it could not be read. */
  affinity: z.number().int().nullable(),
  windowsBuild: z.number().int().nullable(),
  /** True when the read-back confirmed the exclusion rather than assuming it. */
  verified: z.boolean(),
  /** Only WDA_MONITOR is available (Windows 10 before 2004): overlay alpha is lowered. */
  captureSafeMode: z.boolean(),
  detail: z.string()
})
export type ProtectionStatus = z.infer<typeof ProtectionStatusSchema>

export const OverlayStateSchema = z.object({
  visible: z.boolean(),
  clickThrough: z.boolean(),
  /** Whether mouse events currently pass straight through the window. */
  ignoringMouse: z.boolean(),
  panic: z.boolean(),
  canary: z.boolean(),
  protection: ProtectionStatusSchema
})
export type OverlayState = z.infer<typeof OverlayStateSchema>

export const RectSchema = z.object({
  x: z.number(),
  y: z.number(),
  width: z.number().nonnegative(),
  height: z.number().nonnegative()
})
export type Rect = z.infer<typeof RectSchema>

export const VerdictSchema = z.enum(['PASS', 'FAIL', 'INCONCLUSIVE'])
export type Verdict = z.infer<typeof VerdictSchema>

export const RegionResultSchema = z.object({
  row: z.number().int(),
  col: z.number().int(),
  canaryPixels: z.number().int(),
  totalPixels: z.number().int(),
  status: z.enum(['PASS', 'FAIL'])
})
export type RegionResult = z.infer<typeof RegionResultSchema>

export const SelfTestResultSchema = z.object({
  verdict: VerdictSchema,
  ranAt: z.string(),
  displayId: z.number().int(),
  scaleFactor: z.number(),
  overlayRectPx: RectSchema,
  grid: z.object({ cols: z.number().int(), rows: z.number().int() }),
  /** Overlay painted with the canary and protection ON: what a recorder sees. */
  protectedRegions: z.array(RegionResultSchema),
  /** Positive control with protection OFF: proves the test can see the overlay. */
  controlDetectedFraction: z.number(),
  protection: ProtectionStatusSchema,
  notes: z.array(z.string()),
  protectedImage: z.string().nullable(),
  controlImage: z.string().nullable()
})
export type SelfTestResult = z.infer<typeof SelfTestResultSchema>

export const CAPTURE_APPS = [
  'Zoom',
  'Google Meet',
  'Microsoft Teams',
  'OBS Display Capture',
  'OBS Window Capture',
  'Snipping Tool',
  'Xbox Game Bar',
  'Loom',
  'Discord',
  'Other'
] as const
export const CaptureAppSchema = z.enum(CAPTURE_APPS)
export type CaptureApp = z.infer<typeof CaptureAppSchema>

export const LiveReportSchema = z.object({
  app: CaptureAppSchema,
  /** True if the overlay was visible in the recording or share (a FAIL). */
  overlayVisible: z.boolean(),
  notes: z.string().max(500)
})
export type LiveReport = z.infer<typeof LiveReportSchema>

export const MatrixRowSchema = z.object({
  app: CaptureAppSchema,
  result: z.enum(['PASS', 'FAIL']),
  notes: z.string(),
  testedAt: z.string(),
  windowsBuild: z.number().int().nullable()
})
export type MatrixRow = z.infer<typeof MatrixRowSchema>

export const LiveStatusSchema = z.object({ endsAt: z.number().nullable() })
export type LiveStatus = z.infer<typeof LiveStatusSchema>
