import { useEffect, useState } from 'react'
import { Check, Copy, KeyRound, QrCode, Smartphone, Wifi } from 'lucide-react'
import type { CompanionInfo } from '../../../shared/transcript'
import { subscribe } from '../ipc'
import { IS_MAC } from '../platform'
import { useSettingsStore } from '../store'
import { Badge, Button, Card, Loading, Notice, Row, Toggle } from '../ui'

export function CompanionPage() {
  const { settings, update } = useSettingsStore()
  const [info, setInfo] = useState<CompanionInfo | null>(null)
  const [copied, setCopied] = useState<string | null>(null)

  useEffect(() => {
    void window.glimpse.invoke('companion:info', null).then(setInfo)
    return subscribe('companion:info', setInfo)
  }, [])

  if (settings === null) return <Loading label="Loading companion settings" />

  const copy = (url: string): void => {
    void navigator.clipboard.writeText(url).then(() => {
      setCopied(url)
    })
  }

  return (
    <>
      <Card
        title="Companion page"
        icon={Smartphone}
        description="Useful when the overlay isn't visible to you, for example when you view this PC through Moonlight or Parsec. Served from this PC only; nothing goes through the internet."
        actions={
          <Badge tone={info?.running === true ? 'good' : 'neutral'} dot={info?.running === true}>
            {info?.running === true ? 'Running' : 'Off'}
          </Badge>
        }
      >
        <Row label="Turn on" hint="Serve the live transcript and answers to a browser">
          <Toggle checked={settings.companionEnabled} onChange={(checked) => void update({ companionEnabled: checked })} />
        </Row>
        <Row label="Allow other devices" hint="Your phone on the same Wi-Fi or Tailscale. Off means only this PC can open it.">
          <Toggle checked={settings.companionLan} onChange={(checked) => void update({ companionLan: checked })} />
        </Row>
      </Card>

      {info !== null && settings.companionEnabled && (
        <Card title="Open it on your device" icon={settings.companionLan ? QrCode : Wifi}>
          <div className="flex flex-wrap items-start gap-6">
            {info.qr !== null && settings.companionLan && (
              <div className="rounded-2xl bg-white p-2 shadow-[0_10px_40px_-12px_rgb(139_92_246/0.7)]">
                <img src={info.qr} alt="QR code for the companion page" className="h-40 w-40" />
              </div>
            )}
            <div className="min-w-0 flex-1 space-y-2.5">
              {info.message !== '' && <p className="text-xs text-text-faint">{info.message}</p>}
              {info.urls.map((url) => (
                <div key={url} className="flex items-center gap-2 rounded-xl border border-hairline bg-ink/60 py-1.5 pl-3.5 pr-1.5">
                  <code className="min-w-0 flex-1 truncate font-mono text-xs text-text" title={url}>
                    {url}
                  </code>
                  <Button size="sm" tone={copied === url ? 'ghost' : 'subtle'} icon={copied === url ? Check : Copy} onClick={() => { copy(url) }}>
                    {copied === url ? 'Copied' : 'Copy'}
                  </Button>
                </div>
              ))}
              {!settings.companionLan && <p className="text-xs text-text-faint">Turn on “Allow other devices” to get a QR code for your phone.</p>}
              <Notice tone="warn">
                Treat these links like a password: anyone on your network with one can read the transcript. The first time you allow other devices,
                {IS_MAC ? "macOS asks whether Glimpse may find devices on your local network — allow it." : "Windows asks whether Glimpse may use the network — allow private networks."}
              </Notice>
              <Button tone="ghost" size="sm" icon={KeyRound} onClick={() => void window.glimpse.invoke('companion:regenerate', null).then(setInfo)}>
                New access code
              </Button>
            </div>
          </div>
        </Card>
      )}
    </>
  )
}
