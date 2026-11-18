import { z } from 'zod'
import { MatrixRowSchema, SelfTestResultSchema, type MatrixRow, type SelfTestResult } from '../../shared/capture'
import type { Db } from '../db'

const ResultRowSchema = z.object({ result: z.string() })

/** Persists the last capture self-test and the live-capture matrix. */
export class CaptureStore {
  constructor(private readonly db: Db) {}

  /** Stores the verdict and per-region numbers. The screenshot strips are deliberately not saved: they show the user's screen. */
  saveSelfTest(result: SelfTestResult): void {
    const stored: SelfTestResult = { ...result, protectedImage: null, controlImage: null }
    this.db
      .prepare('INSERT INTO self_test (id, result) VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET result = excluded.result')
      .run(JSON.stringify(stored))
  }

  lastSelfTest(): SelfTestResult | null {
    const row = ResultRowSchema.safeParse(this.db.prepare('SELECT result FROM self_test WHERE id = 1').get())
    if (!row.success) return null
    try {
      const parsed = SelfTestResultSchema.safeParse(JSON.parse(row.data.result) as unknown)
      return parsed.success ? parsed.data : null
    } catch {
      return null
    }
  }

  saveMatrixRow(row: MatrixRow): void {
    this.db
      .prepare(
        `INSERT INTO capture_matrix (app, result, notes, tested_at, windows_build) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(app) DO UPDATE SET result = excluded.result, notes = excluded.notes,
           tested_at = excluded.tested_at, windows_build = excluded.windows_build`
      )
      .run(row.app, row.result, row.notes, row.testedAt, row.windowsBuild)
  }

  matrix(): MatrixRow[] {
    const rows = this.db
      .prepare('SELECT app, result, notes, tested_at AS testedAt, windows_build AS windowsBuild FROM capture_matrix ORDER BY app')
      .all()
    return rows.flatMap((row) => {
      const parsed = MatrixRowSchema.safeParse(row)
      return parsed.success ? [parsed.data] : []
    })
  }
}
