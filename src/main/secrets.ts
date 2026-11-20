import { safeStorage } from 'electron'
import type { SettingsStore } from './settingsStore'

/** API keys, and the calendar's secret address (anyone with it can read the calendar). */
export type SecretName = 'anthropic' | 'groq' | 'calendar'
const NAMES: readonly SecretName[] = ['anthropic', 'groq', 'calendar']

/**
 * API keys, encrypted with Windows DPAPI through Electron safeStorage and kept in
 * the settings database. Decrypted keys live only in main-process memory and never
 * go back to a renderer; without encryption, keys are refused rather than stored
 * in plain text. Call `load()` once after the app is ready.
 */
export class SecretStore {
  private readonly plain = new Map<SecretName, string>()
  private encryption = false

  constructor(private readonly settings: SettingsStore) {}

  get available(): boolean {
    return this.encryption
  }

  async load(): Promise<void> {
    this.encryption = await safeStorage.isAsyncEncryptionAvailable()
    if (!this.encryption) return
    for (const name of NAMES) {
      const stored = this.settings.getRaw(`secret:${name}`) ?? ''
      if (stored === '') continue
      try {
        const { result, shouldReEncrypt } = await safeStorage.decryptStringAsync(Buffer.from(stored, 'base64'))
        this.plain.set(name, result)
        if (shouldReEncrypt) await this.set(name, result)
      } catch {
        // Unreadable (e.g. a different Windows account): treat as not set.
      }
    }
  }

  get(name: SecretName): string | null {
    return this.plain.get(name) ?? null
  }

  has(name: SecretName): boolean {
    return this.plain.has(name)
  }

  /** Stores a key, or removes it when `value` is empty. */
  async set(name: SecretName, value: string): Promise<void> {
    const trimmed = value.trim()
    if (trimmed === '') {
      this.settings.setRaw(`secret:${name}`, '')
      this.plain.delete(name)
      return
    }
    if (!this.encryption) throw new Error('Windows could not encrypt the key, so it was not saved.')
    const encrypted = await safeStorage.encryptStringAsync(trimmed)
    this.settings.setRaw(`secret:${name}`, encrypted.toString('base64'))
    this.plain.set(name, trimmed)
  }
}
