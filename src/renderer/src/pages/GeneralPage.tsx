import { Briefcase, Code2, Handshake, Layers, ListChecks, MessagesSquare, MonitorSmartphone, type LucideIcon } from 'lucide-react'
import type { Mode } from '../../../shared/settings'
import { OS_NAME, TRAY_NAME } from '../platform'
import { useSettingsStore } from '../store'
import { Card, Loading, Row, Slider, Toggle } from '../ui'

const MODES: readonly { value: Mode; label: string; hint: string; icon: LucideIcon }[] = [
  { value: 'interview', label: 'Interview', hint: 'First-person answers from your experience', icon: Briefcase },
  { value: 'technical', label: 'Technical', hint: 'Precise answers with the key trade-off', icon: Code2 },
  { value: 'sales', label: 'Sales call', hint: 'Objections, needs and next steps', icon: Handshake },
  { value: 'general', label: 'General', hint: 'Helpful replies for any conversation', icon: MessagesSquare },
  { value: 'recap', label: 'Recap', hint: 'Decisions, open questions, next steps', icon: ListChecks }
]

export function GeneralPage() {
  const { settings, update } = useSettingsStore()
  if (settings === null) return <Loading label="Loading settings" />

  return (
    <>
      <Card title="Answer mode" icon={Layers} description="Shapes the tone and focus of every answer.">
        <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-3" role="radiogroup" aria-label="Answer mode">
          {MODES.map(({ value, label, hint, icon: Icon }) => {
            const active = settings.mode === value
            return (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => void update({ mode: value })}
                className={`group flex cursor-pointer items-start gap-3 rounded-xl border p-3 text-left transition duration-200 active:scale-[0.98] ${
                  active
                    ? 'border-violet/50 bg-violet/[0.10] shadow-[0_0_0_1px_rgb(139_92_246/0.25),0_10px_30px_-16px_rgb(139_92_246/0.8)]'
                    : 'border-hairline bg-white/[0.02] hover:border-white/15 hover:bg-white/[0.04]'
                }`}
              >
                <div className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg transition ${active ? 'brand-gradient text-white' : 'bg-white/[0.05] text-text-faint group-hover:text-text-muted'}`}>
                  <Icon className="h-4 w-4" aria-hidden />
                </div>
                <div className="min-w-0">
                  <div className="text-[13px] font-semibold text-white">{label}</div>
                  <div className="mt-0.5 text-[11.5px] leading-snug text-text-faint">{hint}</div>
                </div>
              </button>
            )
          })}
        </div>
      </Card>

      <Card title="Overlay" icon={MonitorSmartphone} description="The answer panel on the right of your screen. It never appears in screen shares or recordings.">
        <Row label="Show overlay when Glimpse starts" hint={`Off: the overlay stays hidden until you turn it on (sidebar button, ${TRAY_NAME} menu or hotkey)`}>
          <Toggle checked={settings.overlayOnStart} onChange={(checked) => void update({ overlayOnStart: checked })} />
        </Row>
        <Row label="Click-through" hint="Clicks pass through the panel to the app behind it; the header stays clickable">
          <Toggle checked={settings.clickThrough} onChange={(checked) => void update({ clickThrough: checked })} />
        </Row>
        <Row label="Opacity" hint={`${String(Math.round(settings.overlayOpacity * 100))}% — lower it to see more of the app behind`}>
          <Slider min={0.15} max={1} step={0.05} value={settings.overlayOpacity} onChange={(value) => void update({ overlayOpacity: value })} />
        </Row>
        <Row label="Launch at login" hint={`Start Glimpse in the ${TRAY_NAME} when you sign in to ${OS_NAME} (installed app only)`}>
          <Toggle checked={settings.launchAtLogin} onChange={(checked) => void update({ launchAtLogin: checked })} />
        </Row>
      </Card>
    </>
  )
}
