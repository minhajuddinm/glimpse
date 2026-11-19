import { useCallback, useEffect, useState, type KeyboardEvent } from 'react'
import { HOTKEY_ACTIONS, HOTKEY_LABELS, acceleratorFromKeyEvent, type HotkeyAction } from '../../../shared/accelerator'
import { errorMessage } from '../ipc'
import { useSettingsStore } from '../store'
import { Keyboard, RefreshCw } from 'lucide-react'
import { Button, Card, Loading, Row } from '../ui'

export function HotkeysPage() {
  const settings = useSettingsStore((state) => state.settings)
  const [recording, setRecording] = useState<HotkeyAction | null>(null)
  const [messages, setMessages] = useState<Partial<Record<HotkeyAction, string>>>({})
  const [failures, setFailures] = useState<Partial<Record<HotkeyAction, string>>>({})

  const refreshFailures = useCallback(async (): Promise<void> => {
    const status = await window.glimpse.invoke('hotkeys:status', null)
    setFailures(status.failures)
  }, [])

  useEffect(() => {
    void refreshFailures()
  }, [refreshFailures])

  if (settings === null) return <Loading label="Loading hotkeys" />

  const submit = async (action: HotkeyAction, accelerator: string): Promise<void> => {
    try {
      const result = await window.glimpse.invoke('hotkeys:set', { action, accelerator })
      setMessages((previous) => ({ ...previous, [action]: result.ok ? 'Saved.' : result.error }))
      await refreshFailures()
    } catch (error) {
      setMessages((previous) => ({ ...previous, [action]: errorMessage(error) }))
    }
  }

  const onKeyDown = (action: HotkeyAction, event: KeyboardEvent<HTMLButtonElement>): void => {
    event.preventDefault()
    if (event.key === 'Escape') {
      setRecording(null)
      return
    }
    const accelerator = acceleratorFromKeyEvent(event.nativeEvent)
    if (accelerator === null) {
      // Only a modifier so far, or no modifier at all: keep listening.
      if (!['Control', 'Alt', 'Shift', 'Meta'].includes(event.key)) {
        setMessages((previous) => ({ ...previous, [action]: 'Hold at least one modifier (Ctrl, Alt, Shift, Win) and press a key.' }))
      }
      return
    }
    setRecording(null)
    void submit(action, accelerator)
  }

  return (
    <Card title="Shortcuts" icon={Keyboard} description="Click a shortcut, then press the new keys (with Ctrl, Alt, Shift or Win). Esc cancels.">
      {HOTKEY_ACTIONS.map((action) => {
        const failure = failures[action]
        const message = messages[action] ?? failure
        return (
          <Row
            key={action}
            label={HOTKEY_LABELS[action]}
            hint={message ?? 'Global shortcut, works in any app'}
            warn={failure !== undefined || (message !== undefined && message !== 'Saved.')}
          >
            <div className="flex items-center gap-2">
              <button
                type="button"
                onKeyDown={(event) => {
                  if (recording === action) onKeyDown(action, event)
                }}
                onBlur={() => {
                  setRecording((current) => (current === action ? null : current))
                }}
                onClick={() => {
                  setRecording(action)
                }}
                className={`h-9 min-w-44 cursor-pointer rounded-lg border px-3 text-left font-mono text-xs transition duration-200 ${
                  recording === action
                    ? 'animate-pulse border-violet/70 bg-violet/15 text-violet-soft ring-2 ring-violet/25'
                    : failure !== undefined
                      ? 'border-amber-400/40 bg-amber-400/[0.06] text-amber-100 hover:border-amber-400/60'
                      : 'border-hairline-strong bg-ink/70 text-white hover:border-white/20'
                }`}
              >
                {recording === action ? 'Press the new shortcut…' : settings.hotkeys[action]}
              </button>
              <Button
                tone="subtle"
                size="sm"
                icon={RefreshCw}
                title="Register this shortcut again"
                onClick={() => {
                  void submit(action, settings.hotkeys[action])
                }}
              />
            </div>
          </Row>
        )
      })}
    </Card>
  )
}
