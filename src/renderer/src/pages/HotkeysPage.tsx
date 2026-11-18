import { useCallback, useEffect, useState, type KeyboardEvent } from 'react'
import { HOTKEY_ACTIONS, HOTKEY_LABELS, acceleratorFromKeyEvent, type HotkeyAction } from '../../../shared/accelerator'
import { errorMessage } from '../ipc'
import { useSettingsStore } from '../store'
import { Button, Card, Row } from '../ui'

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

  if (settings === null) return <div className="text-sm text-white/50">Loading settings…</div>

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
    <Card>
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
                className={`min-w-44 rounded-md border px-3 py-1.5 text-left font-mono text-xs ${
                  recording === action ? 'border-violet bg-violet/15 text-violet' : 'border-hairline bg-ink text-white'
                }`}
              >
                {recording === action ? 'Press the new shortcut…' : settings.hotkeys[action]}
              </button>
              <Button
                tone="ghost"
                onClick={() => {
                  void submit(action, settings.hotkeys[action])
                }}
              >
                Re-register
              </Button>
            </div>
          </Row>
        )
      })}
    </Card>
  )
}
