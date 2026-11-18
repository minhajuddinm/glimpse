import type { ReactNode } from 'react'

export function Row({
  label,
  hint,
  warn = false,
  children
}: {
  label: string
  hint: string
  warn?: boolean
  children: ReactNode
}) {
  return (
    <div className="flex items-center justify-between gap-6 border-b border-hairline py-4 last:border-b-0">
      <div>
        <div className="text-sm font-medium text-white">{label}</div>
        <div className={`text-xs ${warn ? 'text-amber-300' : 'text-white/50'}`}>{hint}</div>
      </div>
      {children}
    </div>
  )
}

export function Card({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <section className="rounded-xl border border-hairline bg-panel p-5">
      {title !== undefined && <h2 className="mb-3 text-sm font-semibold text-white">{title}</h2>}
      {children}
    </section>
  )
}

const BADGE_TONES = {
  good: 'bg-emerald-400/15 text-emerald-300',
  bad: 'bg-red-500/15 text-red-300',
  warn: 'bg-amber-400/15 text-amber-300',
  neutral: 'bg-white/10 text-white/70'
} as const

export function Badge({ tone, children }: { tone: keyof typeof BADGE_TONES; children: ReactNode }) {
  return <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${BADGE_TONES[tone]}`}>{children}</span>
}

export function Button({
  children,
  onClick,
  disabled = false,
  tone = 'primary'
}: {
  children: ReactNode
  onClick: () => void
  disabled?: boolean
  tone?: 'primary' | 'ghost'
}) {
  const style =
    tone === 'primary'
      ? 'bg-violet text-white hover:bg-violet/85'
      : 'border border-hairline text-white/80 hover:bg-white/10'
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`rounded-md px-3.5 py-1.5 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-40 ${style}`}
    >
      {children}
    </button>
  )
}

export function ErrorBanner({ message }: { message: string }) {
  return (
    <div role="alert" className="rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-200">
      {message}
    </div>
  )
}
