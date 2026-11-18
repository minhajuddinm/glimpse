import { z } from 'zod'

export const HOTKEY_ACTIONS = [
  'toggleOverlay',
  'toggleClickThrough',
  'panicHide',
  'answerNow',
  'elaborate',
  'regenerate',
  'screenshot',
  'toggleMic',
  'clearAnswers'
] as const
export type HotkeyAction = (typeof HOTKEY_ACTIONS)[number]

export const HOTKEY_LABELS: Record<HotkeyAction, string> = {
  toggleOverlay: 'Show / hide overlay',
  toggleClickThrough: 'Toggle click-through',
  panicHide: 'Panic hide (hide everything, mute capture)',
  answerNow: 'Answer the last question now',
  elaborate: 'Elaborate on the last answer',
  regenerate: 'Regenerate the last answer',
  screenshot: 'Answer from a screenshot of your screen',
  toggleMic: 'Mute / unmute your microphone',
  clearAnswers: 'Clear answers'
}

const MODIFIER_ORDER = ['Ctrl', 'Alt', 'Shift', 'Super'] as const
type Modifier = (typeof MODIFIER_ORDER)[number]

const MODIFIER_ALIASES: Readonly<Record<string, Modifier>> = {
  ctrl: 'Ctrl',
  control: 'Ctrl',
  commandorcontrol: 'Ctrl',
  cmdorctrl: 'Ctrl',
  alt: 'Alt',
  option: 'Alt',
  shift: 'Shift',
  super: 'Super',
  meta: 'Super',
  win: 'Super'
}

const NAMED_KEYS: Readonly<Record<string, string>> = {
  space: 'Space',
  tab: 'Tab',
  enter: 'Enter',
  return: 'Enter',
  backspace: 'Backspace',
  delete: 'Delete',
  insert: 'Insert',
  home: 'Home',
  end: 'End',
  pageup: 'PageUp',
  pagedown: 'PageDown',
  up: 'Up',
  down: 'Down',
  left: 'Left',
  right: 'Right',
  plus: 'Plus',
  minus: 'Minus'
}

const PUNCTUATION = new Set(['\\', '/', ';', "'", '[', ']', ',', '.', '=', '-', '`'])

function canonicalKey(raw: string): string | null {
  if (/^[a-z0-9]$/i.test(raw)) return raw.toUpperCase()
  if (/^f([1-9]|1\d|2[0-4])$/i.test(raw)) return raw.toUpperCase()
  const named = NAMED_KEYS[raw.toLowerCase()]
  if (named !== undefined) return named
  return PUNCTUATION.has(raw) ? raw : null
}

export interface ParsedAccelerator {
  readonly modifiers: readonly Modifier[]
  readonly key: string
}

/**
 * Parses "Ctrl+Alt+Space" style accelerators. At least one modifier is required,
 * because an unmodified global hotkey would hijack a normal key everywhere.
 */
export function parseAccelerator(input: string): ParsedAccelerator | null {
  const parts = input.split('+').map((part) => part.trim())
  // "Ctrl++" style: an empty last part means the key is the "+" character.
  const last = parts.at(-1)
  if (last === undefined || last.length === 0) return null
  const key = canonicalKey(last)
  if (key === null) return null
  const found = new Set<Modifier>()
  for (const part of parts.slice(0, -1)) {
    const modifier = MODIFIER_ALIASES[part.toLowerCase()]
    if (modifier === undefined) return null
    found.add(modifier)
  }
  if (found.size === 0) return null
  return { modifiers: MODIFIER_ORDER.filter((modifier) => found.has(modifier)), key }
}

export function normalizeAccelerator(input: string): string | null {
  const parsed = parseAccelerator(input)
  return parsed === null ? null : [...parsed.modifiers, parsed.key].join('+')
}

export const AcceleratorSchema = z
  .string()
  .refine((value) => parseAccelerator(value) !== null, { message: 'Not a valid shortcut (needs a modifier and a key)' })
  .transform((value) => normalizeAccelerator(value) ?? value)

export interface KeyEventLike {
  readonly ctrlKey: boolean
  readonly altKey: boolean
  readonly shiftKey: boolean
  readonly metaKey: boolean
  readonly code: string
}

const CODE_TO_KEY: Readonly<Record<string, string>> = {
  Backslash: '\\',
  Slash: '/',
  Semicolon: ';',
  Quote: "'",
  BracketLeft: '[',
  BracketRight: ']',
  Comma: ',',
  Period: '.',
  Equal: '=',
  Minus: '-',
  Backquote: '`',
  ArrowUp: 'Up',
  ArrowDown: 'Down',
  ArrowLeft: 'Left',
  ArrowRight: 'Right'
}

/** Builds an accelerator from a keydown event, or null if it is only modifiers / has none. */
export function acceleratorFromKeyEvent(event: KeyEventLike): string | null {
  let key: string | undefined = CODE_TO_KEY[event.code]
  if (key === undefined) {
    const letter = /^Key([A-Z])$/.exec(event.code)
    const digit = /^Digit(\d)$/.exec(event.code)
    key = letter?.[1] ?? digit?.[1] ?? event.code
  }
  const modifiers: string[] = []
  if (event.ctrlKey) modifiers.push('Ctrl')
  if (event.altKey) modifiers.push('Alt')
  if (event.shiftKey) modifiers.push('Shift')
  if (event.metaKey) modifiers.push('Super')
  return normalizeAccelerator([...modifiers, key].join('+'))
}

export const DEFAULT_HOTKEYS = {
  toggleOverlay: 'Ctrl+Alt+G',
  toggleClickThrough: 'Ctrl+Alt+C',
  panicHide: 'Ctrl+Alt+H',
  answerNow: 'Ctrl+Alt+Enter',
  elaborate: 'Ctrl+Alt+E',
  regenerate: 'Ctrl+Alt+R',
  screenshot: 'Ctrl+Alt+S',
  toggleMic: 'Ctrl+Alt+M',
  clearAnswers: 'Ctrl+Alt+X'
} as const satisfies Record<HotkeyAction, string>

/** Later actions have defaults so settings saved by an older version still parse. */
export const HotkeysSchema = z.object({
  toggleOverlay: AcceleratorSchema,
  toggleClickThrough: AcceleratorSchema,
  panicHide: AcceleratorSchema,
  answerNow: AcceleratorSchema.default(DEFAULT_HOTKEYS.answerNow),
  elaborate: AcceleratorSchema.default(DEFAULT_HOTKEYS.elaborate),
  regenerate: AcceleratorSchema.default(DEFAULT_HOTKEYS.regenerate),
  screenshot: AcceleratorSchema.default(DEFAULT_HOTKEYS.screenshot),
  toggleMic: AcceleratorSchema.default(DEFAULT_HOTKEYS.toggleMic),
  clearAnswers: AcceleratorSchema.default(DEFAULT_HOTKEYS.clearAnswers)
})
export type Hotkeys = z.infer<typeof HotkeysSchema>
