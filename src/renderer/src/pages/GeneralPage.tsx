import { ModeSchema, type Mode } from '../../../shared/settings'
import { useSettingsStore } from '../store'
import { Card, Row } from '../ui'

const MODE_LABELS: Record<Mode, string> = {
  general: 'General',
  interview: 'Interview',
  sales: 'Sales call',
  technical: 'Technical',
  recap: 'Recap'
}

export function GeneralPage() {
  const { settings, update } = useSettingsStore()
  if (settings === null) return <div className="text-sm text-white/50">Loading settings…</div>

  return (
    <Card>
      <Row label="Mode" hint="Prompt template used for answers">
        <select
          className="rounded-md border border-hairline bg-ink px-3 py-1.5 text-sm text-white"
          value={settings.mode}
          onChange={(event) => {
            const parsed = ModeSchema.safeParse(event.target.value)
            if (parsed.success) void update({ mode: parsed.data })
          }}
        >
          {ModeSchema.options.map((mode) => (
            <option key={mode} value={mode}>
              {MODE_LABELS[mode]}
            </option>
          ))}
        </select>
      </Row>
      <Row label="Click-through" hint="Clicks pass through the overlay to the app behind it (the header stays clickable)">
        <input
          type="checkbox"
          className="h-4 w-4 accent-violet"
          checked={settings.clickThrough}
          onChange={(event) => void update({ clickThrough: event.target.checked })}
        />
      </Row>
      <Row label="Overlay opacity" hint={`${Math.round(settings.overlayOpacity * 100)}%`}>
        <input
          type="range"
          min={0.15}
          max={1}
          step={0.05}
          className="w-40 accent-violet"
          value={settings.overlayOpacity}
          onChange={(event) => void update({ overlayOpacity: Number(event.target.value) })}
        />
      </Row>
      <Row label="Launch at login" hint="Start Glimpse in the tray when you sign in to Windows (installed builds only)">
        <input
          type="checkbox"
          className="h-4 w-4 accent-violet"
          checked={settings.launchAtLogin}
          onChange={(event) => void update({ launchAtLogin: event.target.checked })}
        />
      </Row>
    </Card>
  )
}
