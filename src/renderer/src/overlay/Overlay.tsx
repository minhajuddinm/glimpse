import { useEffect, useRef, useState } from 'react'
import type { OverlayState } from '../../../shared/capture'
import type { Settings } from '../../../shared/settings'
import type { AnswersSnapshot } from '../../../shared/answers'
import type { TranscriptSnapshot } from '../../../shared/transcript'
import { AnswerCards } from './AnswerCards'
import { subscribe } from '../ipc'

interface Paint {
  readonly on: boolean
  readonly seq: number
}

/** Two animation frames: by the second, the browser has painted the committed DOM. */
function afterPaint(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        resolve()
      })
    })
  })
}

function Kbd({ children }: { children: string }) {
  return (
    <kbd className="rounded border border-white/15 bg-white/5 px-1.5 py-0.5 font-sans text-[10px] text-white/70">
      {children}
    </kbd>
  )
}

export function Overlay() {
  const [state, setState] = useState<OverlayState | null>(null)
  const [settings, setSettings] = useState<Settings | null>(null)
  const [paint, setPaint] = useState<Paint>({ on: false, seq: 0 })
  const [answers, setAnswers] = useState<AnswersSnapshot>({ answers: [] })
  const [transcript, setTranscript] = useState<TranscriptSnapshot>({ segments: [], partials: { them: '', you: '' } })
  const headerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    void window.glimpse.invoke('overlay:state', null).then(setState)
    void window.glimpse.invoke('settings:get', null).then(setSettings)
    void window.glimpse.invoke('transcript:get', null).then(setTranscript)
    void window.glimpse.invoke('answers:get', null).then(setAnswers)
    const unsubscribers = [
      subscribe('overlay:state', setState),
      subscribe('settings:changed', setSettings),
      subscribe('transcript:update', setTranscript),
      subscribe('answers:update', setAnswers),
      subscribe('overlay:canary', ({ on }) => {
        setPaint((previous) => ({ on, seq: previous.seq + 1 }))
      })
    ]
    return () => {
      for (const unsubscribe of unsubscribers) unsubscribe()
    }
  }, [])

  // Tell main the canary is actually on screen (or cleared) before it captures.
  useEffect(() => {
    if (paint.seq === 0) return
    let cancelled = false
    void afterPaint().then(() => {
      if (!cancelled) void window.glimpse.invoke('overlay:canaryAck', { on: paint.on })
    })
    return () => {
      cancelled = true
    }
  }, [paint])

  // The header is the only region that stays clickable while click-through is on.
  useEffect(() => {
    const header = headerRef.current
    if (header === null) return
    const report = (): void => {
      const { x, y, width, height } = header.getBoundingClientRect()
      void window.glimpse.invoke('overlay:hitRects', { rects: [{ x, y, width, height }] })
    }
    report()
    const observer = new ResizeObserver(report)
    observer.observe(header)
    return () => {
      observer.disconnect()
    }
  }, [])

  const clickThrough = state?.clickThrough ?? true
  const hotkeys = settings?.hotkeys

  return (
    <>
      {paint.on && (
        <div
          aria-hidden
          className="fixed inset-0 z-50"
          style={{ background: 'repeating-linear-gradient(90deg, #ff00ff 0 8px, #00ff00 8px 16px)' }}
        />
      )}
      <div className="flex h-full flex-col p-2.5">
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-white/10 bg-[rgb(14_14_26/0.88)] shadow-[inset_0_0_0_1px_rgb(255_255_255/0.04)]">
          <div ref={headerRef} className="flex h-[56px] shrink-0 items-center gap-2.5 border-b border-white/10 px-4">
            <span className="h-2 w-2 animate-pulse rounded-full bg-violet shadow-[0_0_10px_var(--color-violet)]" />
            <span className="text-[11px] font-semibold tracking-[0.18em] text-white/90">GLIMPSE</span>
            <span
              className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
                clickThrough ? 'bg-violet/20 text-violet' : 'bg-emerald-400/15 text-emerald-300'
              }`}
            >
              {clickThrough ? 'CLICK-THROUGH' : 'INTERACTIVE'}
            </span>
            <button
              type="button"
              title="Toggle click-through"
              className="ml-auto rounded-md border border-white/10 px-2 py-1 text-[11px] text-white/70 hover:bg-white/10"
              onClick={() => void window.glimpse.invoke('settings:update', { clickThrough: !clickThrough })}
            >
              {clickThrough ? 'Unlock' : 'Lock'}
            </button>
          </div>

          <div className="flex min-h-0 flex-1 flex-col gap-3 px-3.5 py-3.5">
            <div className="min-h-0 flex-[3] overflow-hidden">
              {answers.answers.filter((answer) => answer.status !== 'cancelled').length === 0 ? (
                <p className="px-0.5 text-[12px] leading-relaxed text-white/35">
                  Answers appear here when the other side asks something
                  {hotkeys !== undefined ? ` — or press ${hotkeys.answerNow} to answer the last question` : ''}. This panel is excluded from screen capture.
                </p>
              ) : (
                <AnswerCards answers={answers.answers} regenerateKey={hotkeys?.regenerate ?? ''} />
              )}
            </div>
            <ol className="min-h-0 flex-[2] space-y-1 overflow-hidden border-t border-white/5 pt-2.5 text-[12px] leading-relaxed">
              {transcript.segments.length === 0 && transcript.partials.them === '' && transcript.partials.you === '' && (
                <li className="text-white/30">Listening…</li>
              )}
              {transcript.segments.slice(-6).map((segment) => (
                <li key={segment.id} className={segment.source === 'you' ? 'text-right text-white/35' : 'text-white/50'}>
                  <span className={`mr-1.5 text-[9px] font-semibold ${segment.source === 'you' ? 'text-emerald-300/70' : 'text-violet-300/80'}`}>
                    {segment.source === 'you' ? 'YOU' : 'THEM'}
                  </span>
                  {segment.text}
                </li>
              ))}
              {transcript.partials.them !== '' && <li className="text-white/75">{transcript.partials.them}…</li>}
              {transcript.partials.you !== '' && <li className="text-right text-white/40">{transcript.partials.you}…</li>}
            </ol>
          </div>

          <div className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-1 border-t border-white/10 px-4 py-2.5 text-[10px] text-white/45">
            {hotkeys !== undefined && (
              <>
                <span className="flex items-center gap-1.5">
                  <Kbd>{hotkeys.toggleOverlay}</Kbd> show / hide
                </span>
                <span className="flex items-center gap-1.5">
                  <Kbd>{hotkeys.answerNow}</Kbd> answer
                </span>
                <span className="flex items-center gap-1.5">
                  <Kbd>{hotkeys.elaborate}</Kbd> more
                </span>
                <span className="flex items-center gap-1.5">
                  <Kbd>{hotkeys.toggleClickThrough}</Kbd> click-through
                </span>
                <span className="flex items-center gap-1.5">
                  <Kbd>{hotkeys.panicHide}</Kbd> panic
                </span>
              </>
            )}
          </div>
        </div>
      </div>
    </>
  )
}
