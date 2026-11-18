import { HOTKEY_ACTIONS, HOTKEY_LABELS, normalizeAccelerator, type HotkeyAction, type Hotkeys } from '../shared/accelerator'

/** The subset of Electron's globalShortcut that Glimpse uses, so it can be faked in tests. */
export interface ShortcutRegistry {
  register(accelerator: string, callback: () => void): boolean
  unregister(accelerator: string): void
  unregisterAll(): void
}

export type HotkeyHandlers = Readonly<Record<HotkeyAction, () => void>>

export type RebindResult =
  | { readonly ok: true; readonly hotkeys: Hotkeys }
  | { readonly ok: false; readonly error: string; readonly hotkeys: Hotkeys }

export class HotkeyManager {
  private bound: Partial<Record<HotkeyAction, string>> = {}
  private failed: Partial<Record<HotkeyAction, string>> = {}

  constructor(
    private readonly registry: ShortcutRegistry,
    private readonly handlers: HotkeyHandlers
  ) {}

  private tryRegister(action: HotkeyAction, accelerator: string): string | null {
    try {
      const ok = this.registry.register(accelerator, this.handlers[action])
      return ok ? null : `${accelerator} is already in use by another application.`
    } catch {
      return `${accelerator} is not a valid global shortcut.`
    }
  }

  private clearFailure(action: HotkeyAction): void {
    this.failed = Object.fromEntries(Object.entries(this.failed).filter(([key]) => key !== action))
  }

  /** Actions whose shortcut is not currently registered, with the reason. */
  failures(): Partial<Record<HotkeyAction, string>> {
    return { ...this.failed }
  }

  /** Registers every binding. Returns the actions that could not be registered, with the reason. */
  applyAll(hotkeys: Hotkeys): Partial<Record<HotkeyAction, string>> {
    this.registry.unregisterAll()
    this.bound = {}
    const failures: Partial<Record<HotkeyAction, string>> = {}
    for (const action of HOTKEY_ACTIONS) {
      const accelerator = hotkeys[action]
      const failure = this.tryRegister(action, accelerator)
      if (failure === null) this.bound[action] = accelerator
      else failures[action] = failure
    }
    this.failed = failures
    return { ...failures }
  }

  /** Rebinds one action, checking for conflicts with Glimpse's own and other apps' shortcuts. */
  rebind(action: HotkeyAction, requested: string, current: Hotkeys): RebindResult {
    const accelerator = normalizeAccelerator(requested)
    if (accelerator === null) {
      return { ok: false, error: 'Use at least one modifier (Ctrl, Alt, Shift or Win) plus a key.', hotkeys: current }
    }
    for (const other of HOTKEY_ACTIONS) {
      if (other !== action && current[other] === accelerator) {
        return { ok: false, error: `${accelerator} is already used for "${HOTKEY_LABELS[other]}".`, hotkeys: current }
      }
    }
    if (current[action] === accelerator && this.bound[action] === accelerator) {
      this.clearFailure(action)
      return { ok: true, hotkeys: current }
    }

    const previous = this.bound[action]
    if (previous !== undefined) this.registry.unregister(previous)
    const failure = this.tryRegister(action, accelerator)
    if (failure !== null) {
      if (previous !== undefined) this.tryRegister(action, previous)
      return { ok: false, error: failure, hotkeys: current }
    }
    this.bound[action] = accelerator
    this.clearFailure(action)
    return { ok: true, hotkeys: { ...current, [action]: accelerator } }
  }

  dispose(): void {
    this.registry.unregisterAll()
    this.bound = {}
    this.failed = {}
  }
}
