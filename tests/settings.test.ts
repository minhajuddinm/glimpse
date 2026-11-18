import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS, applySettingsPatch, mergeStoredSettings } from '../src/shared/settings'

describe('mergeStoredSettings', () => {
  it('returns defaults for an empty store', () => {
    expect(mergeStoredSettings({})).toEqual(DEFAULT_SETTINGS)
  })

  it('keeps valid fields and replaces corrupt ones with defaults', () => {
    const merged = mergeStoredSettings({ mode: 'sales', overlayOpacity: 7, clickThrough: false })
    expect(merged).toEqual({ ...DEFAULT_SETTINGS, mode: 'sales', clickThrough: false })
  })

  it('ignores unknown keys', () => {
    expect(mergeStoredSettings({ legacyFlag: true })).toEqual(DEFAULT_SETTINGS)
  })
})

describe('applySettingsPatch', () => {
  it('applies defined values and skips undefined ones', () => {
    const next = applySettingsPatch(DEFAULT_SETTINGS, { mode: 'technical' })
    expect(next).toEqual({ ...DEFAULT_SETTINGS, mode: 'technical' })
  })

  it('throws on an invalid value instead of storing it', () => {
    expect(() => applySettingsPatch(DEFAULT_SETTINGS, { overlayOpacity: 2 })).toThrow()
  })
})
