import { BadgeCheck, CalendarClock, Lightbulb, MessageSquareQuote, MonitorUp, NotebookPen, Sparkles, type LucideIcon } from 'lucide-react'
import type { Answer } from '../../../shared/answers'

const ICON: Record<Answer['kind'], LucideIcon> = {
  answer: MessageSquareQuote,
  'talking-points': Lightbulb,
  'fact-check': BadgeCheck,
  screen: MonitorUp,
  elaborate: Sparkles,
  brief: CalendarClock
}

const LABEL: Record<Answer['kind'], string> = {
  answer: 'ANSWER',
  'talking-points': 'TALKING POINTS',
  'fact-check': 'FACT CHECK',
  screen: 'FROM YOUR SCREEN',
  elaborate: 'MORE DETAIL',
  brief: 'MEETING BRIEF'
}

function Thinking() {
  return (
    <div className="flex h-5 items-end gap-1" aria-label="Thinking">
      {[0, 1, 2].map((bar) => (
        <span key={bar} className="w-1.5 animate-pulse rounded-sm bg-violet/80" style={{ height: `${8 + bar * 5}px`, animationDelay: `${bar * 150}ms` }} />
      ))}
    </div>
  )
}

/** Splits "- a\n- b" into bullet items; anything else is one paragraph. */
function Body({ answer, primary }: { answer: Answer; primary: boolean }) {
  const lines = answer.text.split('\n').map((line) => line.trim()).filter((line) => line.length > 0)
  const bullets = lines.length > 1 && lines.every((line) => /^[-•*]\s/.test(line))
  const size = primary ? 'text-[17px] leading-[1.45] text-white' : 'text-[13px] leading-snug text-white/55'
  if (bullets) {
    return (
      <ul className={`space-y-1 ${size}`}>
        {lines.map((line) => (
          <li key={line} className="flex gap-2">
            <span className="text-violet">•</span>
            <span>{line.replace(/^[-•*]\s+/, '')}</span>
          </li>
        ))}
      </ul>
    )
  }
  return <p className={`whitespace-pre-wrap ${size}`}>{answer.text}</p>
}

export function AnswerCards({ answers, regenerateKey }: { answers: readonly Answer[]; regenerateKey: string }) {
  const visible = answers.filter((answer) => answer.status !== 'cancelled').slice(0, 4)
  if (visible.length === 0) return null
  return (
    <div className="flex flex-col gap-2.5">
      {visible.map((answer, index) => {
        const primary = index === 0
        const Icon = ICON[answer.kind]
        return (
          <article
            key={answer.id}
            className={`rounded-2xl border px-3.5 py-3 transition-opacity duration-300 ${
              primary
                ? 'animate-fade-up border-violet/35 bg-[linear-gradient(160deg,rgb(139_92_246/0.16),rgb(99_102_241/0.05))] shadow-[0_12px_32px_-16px_rgb(139_92_246/0.8)]'
                : 'border-white/[0.06] bg-white/[0.025]'
            }`}
            style={{ opacity: primary ? 1 : Math.max(0.35, 0.8 - index * 0.2) }}
          >
            <div className="mb-1.5 flex items-center gap-1.5 text-[10px] font-semibold tracking-[0.14em] text-violet-300">
              <Icon className="h-3.5 w-3.5" aria-hidden />
              {LABEL[answer.kind]}
              {(answer.origin === 'notes' || answer.origin === 'notes+model') && (
                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-400/15 px-1.5 py-px tracking-normal text-emerald-300">
                  <NotebookPen className="h-2.5 w-2.5" aria-hidden />
                  {answer.origin === 'notes' ? 'YOUR NOTES' : 'NOTES + AI'}
                </span>
              )}
              {answer.status === 'streaming' && <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-violet" />}
            </div>
            {primary && answer.question !== '' && <div className="mb-1.5 truncate text-[11px] text-white/40">{answer.question}</div>}
            {answer.status === 'thinking' && answer.text === '' ? (
              <Thinking />
            ) : answer.status === 'error' ? (
              <p className="text-[13px] text-red-300">
                {answer.error ?? 'Something went wrong.'} <span className="text-white/40">Press {regenerateKey} to retry.</span>
              </p>
            ) : (
              <Body answer={answer} primary={primary} />
            )}
            {answer.sources.length > 0 && answer.status !== 'error' && (
              <div className="mt-1.5 truncate text-[10px] text-white/35">from {answer.sources.join(', ')}</div>
            )}
          </article>
        )
      })}
    </div>
  )
}
