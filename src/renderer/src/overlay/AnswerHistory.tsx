import { useCallback, useLayoutEffect, useRef, useState } from 'react'
import type { ReactNode, RefObject } from 'react'
import type { Answer } from '../../../shared/answers'
import { AnswerCards } from './AnswerCards'
import { subscribe } from '../ipc'

interface ReadingPosition {
  followNewest: boolean
  anchor: string | null
  offset: number
}

/** Newest first, but keep the same answer in view while the user reads older ones. */
export function AnswerHistory({ answers, regenerateKey, viewportRef, empty }: {
  answers: readonly Answer[]
  regenerateKey: string
  viewportRef: RefObject<HTMLDivElement>
  empty: ReactNode
}) {
  const position = useRef<ReadingPosition>({ followNewest: true, anchor: null, offset: 0 })
  const [browsing, setBrowsing] = useState(false)
  const [unseen, setUnseen] = useState(0)
  const newestSeen = useRef<number | null>(null)
  const newest = answers.find((answer) => answer.status !== 'cancelled')?.id ?? null

  const remember = useCallback((): void => {
    const viewport = viewportRef.current
    if (viewport === null) return
    const followNewest = viewport.scrollTop <= 8
    const top = viewport.getBoundingClientRect().top
    const first = [...viewport.querySelectorAll<HTMLElement>('[data-answer-id]')]
      .find((element) => element.getBoundingClientRect().bottom > top + 1)
    position.current = {
      followNewest,
      anchor: first?.dataset.answerId ?? null,
      offset: (first?.getBoundingClientRect().top ?? top) - top
    }
    setBrowsing(!followNewest)
    if (followNewest) {
      newestSeen.current = newest
      setUnseen(0)
    }
  }, [viewportRef, newest])

  useLayoutEffect(() => {
    const viewport = viewportRef.current
    if (viewport === null) return
    const saved = position.current
    if (saved.followNewest) {
      viewport.scrollTop = 0
      newestSeen.current = newest
    } else if (saved.anchor !== null) {
      const anchor = [...viewport.querySelectorAll<HTMLElement>('[data-answer-id]')]
        .find((element) => element.dataset.answerId === saved.anchor)
      if (anchor !== undefined) {
        viewport.scrollTop += anchor.getBoundingClientRect().top - viewport.getBoundingClientRect().top - saved.offset
      }
    }
    if (!saved.followNewest && newest !== newestSeen.current) {
      const index = answers.findIndex((answer) => answer.id === newestSeen.current)
      setUnseen(index < 0 ? 1 : index)
    }
  }, [answers, newest, viewportRef])

  useLayoutEffect(() => subscribe('overlay:scroll', ({ deltaY }) => {
    const viewport = viewportRef.current
    if (viewport === null) return
    viewport.scrollTop += deltaY
    remember()
  }), [viewportRef, remember])

  const latest = (): void => {
    if (viewportRef.current !== null) viewportRef.current.scrollTop = 0
    position.current = { followNewest: true, anchor: null, offset: 0 }
    newestSeen.current = newest
    setBrowsing(false)
    setUnseen(0)
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-1.5">
      <div className="flex shrink-0 items-center justify-between text-[10px] text-white/50">
        <span>{browsing ? 'Reading earlier answers' : 'Answers · scroll for earlier'}</span>
        {browsing && <button type="button" data-overlay-control onClick={latest} className="rounded px-2 py-0.5 text-violet-200 hover:bg-white/10">
          {unseen > 0 ? `${unseen} new · Latest ↑` : 'Latest ↑'}
        </button>}
      </div>
      <div ref={viewportRef} role="region" aria-label="Answer history" tabIndex={0}
        onScroll={remember} className="min-h-0 flex-1 overflow-y-auto overscroll-contain pr-1 [overflow-anchor:none]">
        {answers.some((answer) => answer.status !== 'cancelled')
          ? <AnswerCards answers={answers} regenerateKey={regenerateKey} /> : empty}
      </div>
    </div>
  )
}
