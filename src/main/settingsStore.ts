import { z } from 'zod'
import {
  applySettingsPatch,
  mergeStoredSettings,
  type Settings,
  type SettingsPatch
} from '../shared/settings'
import { transaction, type Db } from './db'

const RowsSchema = z.array(z.object({ key: z.string(), value: z.string() }))

export class SettingsStore {
  constructor(private readonly db: Db) {}

  get(): Settings {
    const rows = RowsSchema.parse(this.db.prepare('SELECT key, value FROM settings').all())
    const stored: Record<string, unknown> = {}
    for (const row of rows) {
      try {
        stored[row.key] = JSON.parse(row.value) as unknown
      } catch {
        // A corrupt value is skipped; mergeStoredSettings falls back to the default.
      }
    }
    return mergeStoredSettings(stored)
  }

  update(patch: SettingsPatch): Settings {
    const next = applySettingsPatch(this.get(), patch)
    const upsert = this.db.prepare(
      'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
    )
    transaction(this.db, () => {
      for (const [key, value] of Object.entries(next)) upsert.run(key, JSON.stringify(value))
    })
    return next
  }
}
