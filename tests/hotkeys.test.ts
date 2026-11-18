import { describe, expect, it } from 'vitest'
import { DEFAULT_HOTKEYS } from '../src/shared/accelerator'
import { HotkeyManager, type ShortcutRegistry } from '../src/main/hotkeys'

class FakeRegistry implements ShortcutRegistry {
  readonly active = new Map<string, () => void>()
  /** Accelerators "owned" by another application: registering them fails. */
  readonly taken = new Set<string>()
  readonly invalid = new Set<string>()

  register(accelerator: string, callback: () => void): boolean {
    if (this.invalid.has(accelerator)) throw new Error('invalid accelerator')
    if (this.taken.has(accelerator) || this.active.has(accelerator)) return false
    this.active.set(accelerator, callback)
    return true
  }

  unregister(accelerator: string): void {
    this.active.delete(accelerator)
  }

  unregisterAll(): void {
    this.active.clear()
  }
}

function setup() {
  const registry = new FakeRegistry()
  const calls: string[] = []
  const manager = new HotkeyManager(registry, {
    toggleOverlay: () => calls.push('toggleOverlay'),
    toggleClickThrough: () => calls.push('toggleClickThrough'),
    panicHide: () => calls.push('panicHide')
  })
  return { registry, calls, manager }
}

describe('HotkeyManager.applyAll', () => {
  it('registers every default binding and routes presses to the right handler', () => {
    const { registry, calls, manager } = setup()
    expect(manager.applyAll(DEFAULT_HOTKEYS)).toEqual({})
    registry.active.get(DEFAULT_HOTKEYS.panicHide)?.()
    expect(calls).toEqual(['panicHide'])
  })

  it('reports a shortcut another app already owns without blocking the rest', () => {
    const { registry, manager } = setup()
    registry.taken.add(DEFAULT_HOTKEYS.toggleClickThrough)
    const failures = manager.applyAll(DEFAULT_HOTKEYS)
    expect(Object.keys(failures)).toEqual(['toggleClickThrough'])
    expect(registry.active.has(DEFAULT_HOTKEYS.toggleOverlay)).toBe(true)
  })
})

describe('HotkeyManager.failures', () => {
  it('tracks shortcuts that could not be registered and clears them once they work', () => {
    const { registry, manager } = setup()
    registry.taken.add(DEFAULT_HOTKEYS.panicHide)
    manager.applyAll(DEFAULT_HOTKEYS)
    expect(Object.keys(manager.failures())).toEqual(['panicHide'])

    expect(manager.rebind('panicHide', 'Ctrl+Shift+P', DEFAULT_HOTKEYS).ok).toBe(true)
    expect(manager.failures()).toEqual({})
  })

  it('defaults avoid Ctrl+Alt+Space, which Claude Desktop uses for Quick Entry', () => {
    expect(Object.values(DEFAULT_HOTKEYS)).not.toContain('Ctrl+Alt+Space')
  })
})

describe('HotkeyManager.rebind', () => {
  it('moves a binding to a free shortcut and normalizes it', () => {
    const { registry, manager } = setup()
    manager.applyAll(DEFAULT_HOTKEYS)
    const result = manager.rebind('panicHide', 'shift+ctrl+p', DEFAULT_HOTKEYS)
    expect(result).toEqual({ ok: true, hotkeys: { ...DEFAULT_HOTKEYS, panicHide: 'Ctrl+Shift+P' } })
    expect(registry.active.has(DEFAULT_HOTKEYS.panicHide)).toBe(false)
    expect(registry.active.has('Ctrl+Shift+P')).toBe(true)
  })

  it("refuses a shortcut already used by another of Glimpse's actions", () => {
    const { manager } = setup()
    manager.applyAll(DEFAULT_HOTKEYS)
    const result = manager.rebind('panicHide', DEFAULT_HOTKEYS.toggleOverlay, DEFAULT_HOTKEYS)
    expect(result.ok).toBe(false)
    expect(result.hotkeys).toEqual(DEFAULT_HOTKEYS)
  })

  it('keeps the old binding working when the new shortcut is taken by another app', () => {
    const { registry, manager } = setup()
    manager.applyAll(DEFAULT_HOTKEYS)
    registry.taken.add('Ctrl+Shift+P')
    const result = manager.rebind('panicHide', 'Ctrl+Shift+P', DEFAULT_HOTKEYS)
    expect(result.ok).toBe(false)
    expect(registry.active.has(DEFAULT_HOTKEYS.panicHide)).toBe(true)
  })

  it('keeps the old binding when the new shortcut is rejected as invalid by the OS', () => {
    const { registry, manager } = setup()
    manager.applyAll(DEFAULT_HOTKEYS)
    registry.invalid.add('Ctrl+Shift+P')
    const result = manager.rebind('panicHide', 'Ctrl+Shift+P', DEFAULT_HOTKEYS)
    expect(result.ok).toBe(false)
    expect(registry.active.has(DEFAULT_HOTKEYS.panicHide)).toBe(true)
  })

  it('rejects shortcuts without a modifier', () => {
    const { manager } = setup()
    manager.applyAll(DEFAULT_HOTKEYS)
    expect(manager.rebind('panicHide', 'P', DEFAULT_HOTKEYS).ok).toBe(false)
  })

  it('re-registers an unchanged binding that previously failed (the Re-register button)', () => {
    const { registry, manager } = setup()
    registry.taken.add(DEFAULT_HOTKEYS.panicHide)
    manager.applyAll(DEFAULT_HOTKEYS)
    registry.taken.clear()
    expect(manager.rebind('panicHide', DEFAULT_HOTKEYS.panicHide, DEFAULT_HOTKEYS).ok).toBe(true)
    expect(registry.active.has(DEFAULT_HOTKEYS.panicHide)).toBe(true)
  })
})
