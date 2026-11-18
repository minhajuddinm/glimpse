import { z } from 'zod'
import { applySettingsPatch, mergeStoredSettings, type Settings, type SettingsUpdate } from '../shared/settings'
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

  /** Values stored next to the settings but never sent to a renderer (e.g. the companion access code). */
  getRaw(key: string): string | null {
    const row = RowsSchema.element.safeParse(this.db.prepare('SELECT key, value FROM settings WHERE key = ?').get(key))
    return row.success ? row.data.value : null
  }

  setRaw(key: string, value: string): void {
    this.db
      .prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
      .run(key, value)
  }

  update(patch: SettingsUpdate): Settings {
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
