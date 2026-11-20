import type { ReactNode } from 'react'

/** **bold** spans only; everything else is plain text (no HTML is ever injected). */
function inline(text: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, index) =>
    part.startsWith('**') && part.endsWith('**') && part.length > 4 ? (
      <strong key={index} className="font-semibold text-white">
        {part.slice(2, -2)}
      </strong>
    ) : (
      part
    )
  )
}

type Block =
  | { kind: 'heading'; text: string }
  | { kind: 'task'; text: string; done: boolean }
  | { kind: 'bullet'; text: string }
  | { kind: 'para'; text: string }

export function parseMinutes(markdown: string): Block[] {
  const blocks: Block[] = []
  for (const raw of markdown.split('\n')) {
    const line = raw.trim()
    if (line === '') continue
    const heading = /^#{1,6}\s+(.*)$/.exec(line)
    const task = /^[-*]\s+\[([ xX])\]\s+(.*)$/.exec(line)
    const bullet = /^[-*]\s+(.*)$/.exec(line)
    if (heading?.[1] !== undefined) blocks.push({ kind: 'heading', text: heading[1] })
    else if (task?.[2] !== undefined) blocks.push({ kind: 'task', text: task[2], done: task[1] !== ' ' })
    else if (bullet?.[1] !== undefined) blocks.push({ kind: 'bullet', text: bullet[1] })
    else blocks.push({ kind: 'para', text: line })
  }
  return blocks
}

/** Renders the minutes Markdown Glimpse asks the model for: ## sections, bullets, "- [ ]" action items. */
export function MinutesView({ markdown }: { markdown: string }) {
  return (
    <div className="space-y-1.5 text-[13.5px] leading-relaxed text-text">
      {parseMinutes(markdown).map((block, index) => {
        switch (block.kind) {
          case 'heading':
            return (
              <h3 key={index} className="pt-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-violet-soft first:pt-0">
                {block.text}
              </h3>
            )
          case 'task':
            return (
              <div key={index} className="flex gap-2.5 rounded-lg bg-white/[0.025] px-3 py-1.5">
                <span aria-hidden className={`mt-[5px] h-3.5 w-3.5 shrink-0 rounded border ${block.done ? 'border-emerald-400 bg-emerald-400/30' : 'border-white/30'}`} />
                <span>{inline(block.text)}</span>
              </div>
            )
          case 'bullet':
            return (
              <div key={index} className="flex gap-2.5 pl-1">
                <span aria-hidden className="mt-[9px] h-1 w-1 shrink-0 rounded-full bg-violet-soft" />
                <span>{inline(block.text)}</span>
              </div>
            )
          case 'para':
            return (
              <p key={index} className="text-text">
                {inline(block.text)}
              </p>
            )
        }
      })}
    </div>
  )
}
