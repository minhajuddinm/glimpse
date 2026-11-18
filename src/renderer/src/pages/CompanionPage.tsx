import { useEffect, useState } from 'react'
import type { CompanionInfo } from '../../../shared/transcript'
import { subscribe } from '../ipc'
import { useSettingsStore } from '../store'
import { Badge, Button, Card, Row } from '../ui'

export function CompanionPage() {
  const { settings, update } = useSettingsStore()
  const [info, setInfo] = useState<CompanionInfo | null>(null)
  const [copied, setCopied] = useState<string | null>(null)

  useEffect(() => {
    void window.glimpse.invoke('companion:info', null).then(setInfo)
    return subscribe('companion:info', setInfo)
  }, [])

  if (settings === null) return <div className="text-sm text-white/50">Loading…</div>

  const copy = (url: string): void => {
    void navigator.clipboard.writeText(url).then(() => {
      setCopied(url)
    })
  }

  return (
    <div className="space-y-5">
      <Card>
        <p className="mb-2 text-sm leading-relaxed text-white/70">
          Read the live transcript, and later the answers, on your phone or another computer. This is useful when the overlay
          isn&apos;t visible to you, for example when you view this PC through Moonlight or Parsec. The page is served from this
          PC only. Nothing goes through the internet, and each link carries its own access code.
        </p>
        <Row label="Companion page" hint={info?.running === true ? 'Running' : 'Off'}>
          <input
            type="checkbox"
            className="h-4 w-4 accent-violet"
            checked={settings.companionEnabled}
            onChange={(event) => void update({ companionEnabled: event.target.checked })}
          />
        </Row>
        <Row label="Allow other devices" hint="Listen on your home network and Tailscale. Off means only this PC can open it.">
          <input
            type="checkbox"
            className="h-4 w-4 accent-violet"
            checked={settings.companionLan}
            onChange={(event) => void update({ companionLan: event.target.checked })}
          />
        </Row>
      </Card>

      {info !== null && settings.companionEnabled && (
        <Card title="Open it on your device">
          <div className="flex flex-wrap items-start gap-6">
            {info.qr !== null && <img src={info.qr} alt="QR code for the companion page" className="h-44 w-44 rounded-lg bg-white p-1" />}
            <div className="min-w-0 flex-1 space-y-2">
              <div className="flex items-center gap-2">
                <Badge tone={info.running ? 'good' : 'bad'}>{info.running ? 'running' : 'stopped'}</Badge>
                <span className="text-xs text-white/55">{info.message}</span>
              </div>
              {info.urls.map((url) => (
                <div key={url} className="flex items-center gap-2">
                  <code className="min-w-0 flex-1 truncate rounded bg-ink px-2 py-1 text-xs text-white/80" title={url}>
                    {url}
                  </code>
                  <Button tone="ghost" onClick={() => { copy(url) }}>
                    {copied === url ? 'Copied' : 'Copy'}
                  </Button>
                </div>
              ))}
              <p className="text-xs text-white/45">
                Treat these links like a password: anyone on your network with one can read the transcript. The first time you
                allow other devices, Windows asks whether Glimpse (shown as &quot;Electron&quot;) may use the network; allow private
                networks for your phone to connect.
              </p>
              <Button tone="ghost" onClick={() => void window.glimpse.invoke('companion:regenerate', null).then(setInfo)}>
                New access code (old links stop working)
              </Button>
            </div>
          </div>
        </Card>
      )}
    </div>
  )
}
