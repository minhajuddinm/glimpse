import { cloneElement, isValidElement, type ChangeEvent, type ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'

/** A lone input/select in a row is named by the row label, for screen readers and UI automation. */
function labelled(children: ReactNode, label: string): ReactNode {
  if (isValidElement<{ 'aria-label'?: string }>(children) && (children.type === 'input' || children.type === 'select' || children.type === Toggle || children.type === Select || children.type === Slider)) {
    return cloneElement(children, { 'aria-label': label })
  }
  return children
}

export function PageHeader({ icon: Icon, title, description, actions }: { icon: LucideIcon; title: string; description: string; actions?: ReactNode }) {
  return (
    <header className="mb-6 flex animate-fade-up items-start gap-4">
      <div className="brand-gradient grid h-11 w-11 shrink-0 place-items-center rounded-xl shadow-[0_8px_24px_-8px_rgb(139_92_246/0.7)]">
        <Icon className="h-5 w-5 text-white" strokeWidth={2} aria-hidden />
      </div>
      <div className="min-w-0 flex-1">
        <h1 className="font-[family-name:var(--font-display)] text-[22px] font-semibold tracking-tight text-white">{title}</h1>
        <p className="mt-0.5 max-w-2xl text-[13px] leading-relaxed text-text-muted">{description}</p>
      </div>
      {actions !== undefined && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </header>
  )
}

export function Row({ label, hint, warn = false, children }: { label: string; hint: string; warn?: boolean; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-6 border-b border-hairline py-3.5 last:border-b-0 first:pt-0 last:pb-0">
      <div className="min-w-0">
        <div className="text-[13.5px] font-medium text-white">{label}</div>
        <div className={`mt-0.5 text-xs leading-relaxed ${warn ? 'text-amber-300' : 'text-text-faint'}`}>{hint}</div>
      </div>
      <div className="shrink-0">{labelled(children, label)}</div>
    </div>
  )
}

export function Card({
  title,
  icon: Icon,
  description,
  actions,
  children,
  tone = 'default'
}: {
  title?: string
  icon?: LucideIcon
  description?: string
  actions?: ReactNode
  children: ReactNode
  tone?: 'default' | 'accent'
}) {
  return (
    <section
      className={`surface animate-fade-up rounded-2xl p-5 ${tone === 'accent' ? 'border-violet/30 bg-[linear-gradient(180deg,rgb(139_92_246/0.10),rgb(99_102_241/0.03))]' : ''}`}
    >
      {(title !== undefined || actions !== undefined) && (
        <div className="mb-4 flex items-start gap-3">
          {Icon !== undefined && (
            <div className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-violet/12 text-violet-soft ring-1 ring-violet/20">
              <Icon className="h-4 w-4" aria-hidden />
            </div>
          )}
          <div className="min-w-0 flex-1">
            {title !== undefined && <h2 className="text-[14px] font-semibold text-white">{title}</h2>}
            {description !== undefined && <p className="mt-0.5 text-xs leading-relaxed text-text-faint">{description}</p>}
          </div>
          {actions !== undefined && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
        </div>
      )}
      <div>{children}</div>
    </section>
  )
}

const BADGE_TONES = {
  good: 'bg-emerald-400/12 text-emerald-300 ring-emerald-400/20',
  bad: 'bg-red-500/12 text-red-300 ring-red-400/25',
  warn: 'bg-amber-400/12 text-amber-300 ring-amber-400/20',
  neutral: 'bg-white/[0.06] text-text-muted ring-white/10',
  accent: 'bg-violet/15 text-violet-soft ring-violet/25'
} as const

const DOT_TONES = { good: 'bg-emerald-400', bad: 'bg-red-400', warn: 'bg-amber-400', neutral: 'bg-white/40', accent: 'bg-violet-soft' } as const

export function Badge({ tone, children, dot = false }: { tone: keyof typeof BADGE_TONES; children: ReactNode; dot?: boolean }) {
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-semibold ring-1 ${BADGE_TONES[tone]}`}>
      {dot && <span className={`h-1.5 w-1.5 rounded-full ${DOT_TONES[tone]} ${tone === 'good' ? 'animate-pulse' : ''}`} />}
      {children}
    </span>
  )
}

export function StatusDot({ tone, label }: { tone: keyof typeof DOT_TONES; label: string }) {
  return (
    <span className="relative inline-flex h-2 w-2" role="img" aria-label={label}>
      {tone === 'good' && <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400/60" />}
      <span className={`relative inline-flex h-2 w-2 rounded-full ${DOT_TONES[tone]}`} />
    </span>
  )
}

const BUTTON_TONES = {
  primary: 'brand-gradient text-white shadow-[0_6px_20px_-8px_rgb(139_92_246/0.8)] hover:brightness-110',
  ghost: 'border border-hairline-strong bg-white/[0.03] text-text hover:bg-white/[0.07] hover:border-white/20',
  subtle: 'text-text-muted hover:bg-white/[0.06] hover:text-white',
  danger: 'border border-red-400/30 bg-red-500/10 text-red-200 hover:bg-red-500/20'
} as const

export function Button({
  children,
  onClick,
  disabled = false,
  tone = 'primary',
  icon: Icon,
  size = 'md',
  title
}: {
  children?: ReactNode
  onClick: () => void
  disabled?: boolean
  tone?: keyof typeof BUTTON_TONES
  icon?: LucideIcon | undefined
  size?: 'sm' | 'md'
  title?: string
}) {
  const sizing = size === 'sm' ? 'h-8 px-3 text-xs gap-1.5' : 'h-9 px-4 text-[13px] gap-2'
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      title={title}
      aria-label={children === undefined ? title : undefined}
      className={`inline-flex cursor-pointer items-center justify-center rounded-lg font-medium transition duration-200 active:scale-[0.97] disabled:pointer-events-none disabled:opacity-40 ${sizing} ${BUTTON_TONES[tone]}`}
    >
      {Icon !== undefined && <Icon className={size === 'sm' ? 'h-3.5 w-3.5' : 'h-4 w-4'} aria-hidden />}
      {children}
    </button>
  )
}

/** An accessible on/off switch (role="switch"). */
export function Toggle({ checked, onChange, disabled = false, 'aria-label': ariaLabel }: { checked: boolean; onChange: (checked: boolean) => void; disabled?: boolean; 'aria-label'?: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={() => {
        onChange(!checked)
      }}
      className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full transition duration-200 disabled:cursor-not-allowed disabled:opacity-40 ${
        checked ? 'brand-gradient shadow-[0_0_16px_-4px_rgb(139_92_246/0.9)]' : 'bg-white/12 ring-1 ring-white/10'
      }`}
    >
      <span
        className={`inline-block h-[18px] w-[18px] rounded-full bg-white shadow transition-transform duration-200 ease-[var(--ease-out-expo)] ${checked ? 'translate-x-[23px]' : 'translate-x-[3px]'}`}
      />
    </button>
  )
}

const FIELD = 'rounded-lg border border-hairline-strong bg-ink/70 text-[13px] text-white placeholder:text-text-faint transition focus:border-violet/60 focus:outline-none focus:ring-2 focus:ring-violet/25'

export function Select<T extends string>({
  value,
  options,
  onChange,
  'aria-label': ariaLabel
}: {
  value: T
  options: readonly { value: T; label: string }[]
  onChange: (value: T) => void
  'aria-label'?: string
}) {
  return (
    <select
      aria-label={ariaLabel}
      className={`${FIELD} h-9 cursor-pointer pl-3 pr-8`}
      value={value}
      onChange={(event: ChangeEvent<HTMLSelectElement>) => {
        const found = options.find((option) => option.value === event.target.value)
        if (found !== undefined) onChange(found.value)
      }}
    >
      {options.map((option) => (
        <option key={option.value} value={option.value} className="bg-panel-2">
          {option.label}
        </option>
      ))}
    </select>
  )
}

export function TextInput({
  value,
  onChange,
  placeholder,
  type = 'text',
  onEnter,
  maxLength,
  mono = false,
  'aria-label': ariaLabel
}: {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  type?: 'text' | 'password'
  onEnter?: () => void
  maxLength?: number
  mono?: boolean
  'aria-label'?: string
}) {
  return (
    <input
      type={type}
      value={value}
      maxLength={maxLength}
      placeholder={placeholder}
      aria-label={ariaLabel ?? placeholder}
      autoComplete="off"
      spellCheck={type !== 'password'}
      onChange={(event) => {
        onChange(event.target.value)
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter') onEnter?.()
      }}
      className={`${FIELD} h-9 min-w-0 flex-1 px-3 ${mono ? 'font-mono text-xs' : ''}`}
    />
  )
}

export function TextArea({ value, onChange, placeholder, rows = 6, maxLength, 'aria-label': ariaLabel }: { value: string; onChange: (value: string) => void; placeholder?: string; rows?: number; maxLength?: number; 'aria-label'?: string }) {
  return (
    <textarea
      rows={rows}
      maxLength={maxLength}
      value={value}
      aria-label={ariaLabel ?? placeholder}
      placeholder={placeholder}
      onChange={(event) => {
        onChange(event.target.value)
      }}
      className={`${FIELD} w-full resize-y px-3 py-2.5 leading-relaxed`}
    />
  )
}

export function Slider({ value, min, max, step, onChange, 'aria-label': ariaLabel }: { value: number; min: number; max: number; step: number; onChange: (value: number) => void; 'aria-label'?: string }) {
  const fill = `${(((value - min) / (max - min)) * 100).toFixed(1)}%`
  return (
    <input
      type="range"
      className="slider w-44"
      aria-label={ariaLabel}
      min={min}
      max={max}
      step={step}
      value={value}
      style={{ ['--fill' as string]: fill }}
      onChange={(event) => {
        onChange(Number(event.target.value))
      }}
    />
  )
}

export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="inline-flex h-6 items-center rounded-md border border-hairline-strong border-b-white/20 bg-white/[0.05] px-2 font-mono text-[11px] text-text shadow-[inset_0_-1px_0_rgb(255_255_255/0.06)]">
      {children}
    </kbd>
  )
}

export function EmptyState({ icon: Icon, title, children }: { icon: LucideIcon; title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-hairline-strong px-6 py-8 text-center">
      <div className="grid h-10 w-10 place-items-center rounded-full bg-white/[0.04] text-text-faint">
        <Icon className="h-5 w-5" aria-hidden />
      </div>
      <div className="text-sm font-medium text-white">{title}</div>
      {children !== undefined && <div className="max-w-sm text-xs leading-relaxed text-text-faint">{children}</div>}
    </div>
  )
}

export function Loading({ label }: { label: string }) {
  return (
    <div className="space-y-3" aria-busy="true" aria-label={label}>
      <div className="skeleton h-20 rounded-2xl" />
      <div className="skeleton h-32 rounded-2xl" />
    </div>
  )
}

export function ErrorBanner({ message }: { message: string }) {
  return (
    <div role="alert" className="flex items-start gap-2.5 rounded-xl border border-red-400/30 bg-red-500/[0.08] px-4 py-3 text-[13px] leading-relaxed text-red-200">
      <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-red-400" />
      <span>{message}</span>
    </div>
  )
}

export function Notice({ tone = 'info', children }: { tone?: 'info' | 'warn' | 'good'; children: ReactNode }) {
  const style = {
    info: 'border-indigo/25 bg-indigo/[0.07] text-indigo-100',
    warn: 'border-amber-400/25 bg-amber-400/[0.07] text-amber-100',
    good: 'border-emerald-400/25 bg-emerald-400/[0.07] text-emerald-100'
  }[tone]
  return <div className={`rounded-xl border px-4 py-3 text-[13px] leading-relaxed ${style}`}>{children}</div>
}
