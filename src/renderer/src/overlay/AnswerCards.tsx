import type { Answer } from '../../../shared/answers'

const LABEL: Record<Answer['kind'], string> = {
  answer: 'ANSWER',
  'talking-points': 'TALKING POINTS',
  'fact-check': 'FACT CHECK',
  screen: 'FROM YOUR SCREEN',
  elaborate: 'MORE DETAIL'
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
        return (
          <article
            key={answer.id}
            className={`rounded-xl border px-3.5 py-3 transition-opacity ${
              primary ? 'border-violet/40 bg-violet/[0.08]' : 'border-white/5 bg-white/[0.02]'
            }`}
            style={{ opacity: primary ? 1 : Math.max(0.35, 0.8 - index * 0.2) }}
          >
            <div className="mb-1.5 flex items-center gap-2 text-[10px] font-semibold tracking-[0.14em] text-violet/90">
              {LABEL[answer.kind]}
              {answer.origin === 'notes' && <span className="rounded bg-emerald-400/15 px-1.5 py-px text-emerald-300">FROM YOUR NOTES</span>}
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
