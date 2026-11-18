import { describe, expect, it } from 'vitest'
import {
  AcceleratorSchema,
  DEFAULT_HOTKEYS,
  HOTKEY_ACTIONS,
  acceleratorFromKeyEvent,
  normalizeAccelerator,
  parseAccelerator
} from '../src/shared/accelerator'

describe('normalizeAccelerator', () => {
  it('orders modifiers canonically and upper-cases letters', () => {
    expect(normalizeAccelerator('shift+alt+ctrl+k')).toBe('Ctrl+Alt+Shift+K')
  })

  it('maps aliases to one spelling', () => {
    expect(normalizeAccelerator('CommandOrControl+Space')).toBe('Ctrl+Space')
    expect(normalizeAccelerator('Control+Option+return')).toBe('Ctrl+Alt+Enter')
    expect(normalizeAccelerator('Win+F5')).toBe('Super+F5')
  })

  it('rejects shortcuts without a modifier', () => {
    expect(normalizeAccelerator('K')).toBeNull()
    expect(normalizeAccelerator('F5')).toBeNull()
  })

  it('rejects unknown modifiers and keys', () => {
    expect(normalizeAccelerator('Hyper+K')).toBeNull()
    expect(normalizeAccelerator('Ctrl+Escape')).toBeNull()
    expect(normalizeAccelerator('Ctrl+')).toBeNull()
    expect(normalizeAccelerator('')).toBeNull()
  })

  it('accepts punctuation and function keys', () => {
    expect(normalizeAccelerator('Ctrl+\\')).toBe('Ctrl+\\')
    expect(normalizeAccelerator('ctrl+f12')).toBe('Ctrl+F12')
    expect(parseAccelerator('Alt+F25')).toBeNull()
  })
})

describe('acceleratorFromKeyEvent', () => {
  const base = { ctrlKey: false, altKey: false, shiftKey: false, metaKey: false }

  it('builds an accelerator from letters, digits and punctuation', () => {
    expect(acceleratorFromKeyEvent({ ...base, ctrlKey: true, altKey: true, code: 'KeyH' })).toBe('Ctrl+Alt+H')
    expect(acceleratorFromKeyEvent({ ...base, ctrlKey: true, code: 'Digit7' })).toBe('Ctrl+7')
    expect(acceleratorFromKeyEvent({ ...base, ctrlKey: true, code: 'Backslash' })).toBe('Ctrl+\\')
    expect(acceleratorFromKeyEvent({ ...base, ctrlKey: true, code: 'ArrowUp' })).toBe('Ctrl+Up')
    expect(acceleratorFromKeyEvent({ ...base, metaKey: true, shiftKey: true, code: 'Space' })).toBe('Shift+Super+Space')
  })

  it('returns null with no modifier or when only a modifier key was pressed', () => {
    expect(acceleratorFromKeyEvent({ ...base, code: 'KeyA' })).toBeNull()
    expect(acceleratorFromKeyEvent({ ...base, ctrlKey: true, code: 'ControlLeft' })).toBeNull()
  })
})

describe('defaults', () => {
  it('are valid, normalized and distinct', () => {
    const values = HOTKEY_ACTIONS.map((action) => DEFAULT_HOTKEYS[action])
    for (const value of values) expect(AcceleratorSchema.parse(value)).toBe(value)
    expect(new Set(values).size).toBe(values.length)
  })
})
