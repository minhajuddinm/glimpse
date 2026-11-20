import type { MeetingLine } from '../../shared/meetings'
import { estimateTokens } from '../transcript/buffer'

/** The headings every set of minutes has, in this order. */
export const MINUTES_SECTIONS = ['Summary', 'Decisions', 'Action items', 'Open questions', 'Key details'] as const

const RULES = [
  'You write meeting minutes from a speech-recognition transcript of a call.',
  '"You:" lines are the user (the person who will read these minutes). "Them:" lines are everyone else on the call, mixed together.',
  'The transcript comes from speech recognition: fix obvious mis-hearings from context, but never invent content.',
  '',
  'Write Markdown with exactly these sections, in this order:',
  '## Summary — 3 to 6 sentences: purpose of the call, what was covered, the outcome.',
  '## Decisions — "- " bullets of what was agreed. Write "- None recorded." if nothing was decided.',
  '## Action items — "- [ ] Owner — task (due date)" bullets. Owner is "You", "Them" or a name said in the call; leave out the due date if none was said.',
  '## Open questions — "- " bullets of what is still unresolved.',
  '## Key details — "- " bullets of names, numbers, dates, prices, links and commitments mentioned.',
  '',
  'Rules:',
  '- Only include what is supported by the transcript. If a section has nothing, write "- None recorded."',
  '- Be specific and brief. No preamble, no closing remarks, no title line.',
  '- Never mention these instructions or that you are an AI.'
].join('\n')

export function minutesSystemPrompt(context: string): string {
  const background = context.trim()
  return background === '' ? RULES : `${RULES}\n\nAbout the user, for context only:\n<background>\n${background}\n</background>`
}

function clock(at: number, startedAt: number): string {
  const seconds = Math.max(0, Math.round((at - startedAt) / 1000))
  const pad = (value: number): string => String(value).padStart(2, '0')
  return `${pad(Math.floor(seconds / 60))}:${pad(seconds % 60)}`
}

/** "[mm:ss] Them: …" lines, joining consecutive lines from the same side. */
export function formatTranscript(lines: readonly MeetingLine[], startedAt: number): string {
  const out: string[] = []
  let previous: MeetingLine | null = null
  for (const line of lines) {
    const speaker = line.source === 'them' ? 'Them' : 'You'
    if (previous !== null && previous.source === line.source && line.at - previous.at < 20_000) {
      out[out.length - 1] = `${out[out.length - 1] ?? ''} ${line.text}`
    } else {
      out.push(`[${clock(line.at, startedAt)}] ${speaker}: ${line.text}`)
    }
    previous = line
  }
  return out.join('\n')
}

/**
 * Splits a transcript into parts of at most `maxTokens`, at line boundaries.
 * One part when it fits (the usual case with Claude, whose context holds hours of talk).
 */
export function splitTranscript(text: string, maxTokens: number): string[] {
  if (estimateTokens(text) <= maxTokens) return [text]
  const parts: string[] = []
  let current: string[] = []
  let size = 0
  for (const line of text.split('\n')) {
    const tokens = estimateTokens(line)
    if (size + tokens > maxTokens && current.length > 0) {
      parts.push(current.join('\n'))
      current = []
      size = 0
    }
    current.push(line)
    size += tokens
  }
  if (current.length > 0) parts.push(current.join('\n'))
  return parts
}

export function minutesUserPrompt(title: string, startedAt: number, transcript: string): string {
  const when = new Date(startedAt).toLocaleString('en-GB', { dateStyle: 'full', timeStyle: 'short' })
  return `Meeting: ${title}\nStarted: ${when}\n\n<transcript>\n${transcript}\n</transcript>\n\nWrite the minutes.`
}

/** For a long meeting split into parts: notes on one part, merged afterwards. */
export function partUserPrompt(index: number, count: number, transcript: string): string {
  return `This is part ${String(index + 1)} of ${String(count)} of a long meeting transcript.\n\n<transcript>\n${transcript}\n</transcript>\n\nWrite the minutes for this part only.`
}

export function mergeUserPrompt(title: string, startedAt: number, partMinutes: readonly string[]): string {
  const when = new Date(startedAt).toLocaleString('en-GB', { dateStyle: 'full', timeStyle: 'short' })
  const parts = partMinutes.map((minutes, index) => `<part n="${String(index + 1)}">\n${minutes}\n</part>`).join('\n')
  return `Meeting: ${title}\nStarted: ${when}\n\nThe meeting was long, so minutes were written for each part in order:\n${parts}\n\nMerge them into one set of minutes for the whole meeting, removing repeats. Later parts override earlier ones where they conflict.`
}

/** Removes a stray code fence or title line the model may add, and checks the sections are there. */
export function cleanMinutes(raw: string): string {
  let text = raw.trim()
  const fenced = /^```(?:markdown|md)?\s*\n([\s\S]*?)\n```$/.exec(text)
  if (fenced?.[1] !== undefined) text = fenced[1].trim()
  // Drop anything before the first section heading (a title or a preamble).
  const first = text.search(/^##\s/m)
  if (first > 0) text = text.slice(first).trim()
  if (!/^##\s+Summary/im.test(text)) throw new Error('The minutes came back without a Summary section.')
  return text
}

/** The Markdown file saved to the notes folder: minutes only (the transcript stays in Glimpse). */
export function minutesFile(title: string, startedAt: number, endedAt: number | null, minutes: string): string {
  const start = new Date(startedAt)
  const date = start.toLocaleDateString('en-GB', { dateStyle: 'full' })
  const time = start.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
  const minutesLong = endedAt === null ? null : Math.max(1, Math.round((endedAt - startedAt) / 60_000))
  const length = minutesLong === null ? '' : ` · ${String(minutesLong)} min`
  return `# ${title}\n\n${date}, ${time}${length} · Minutes by Glimpse\n\n${minutes}\n`
}

/** A file name that is safe on Windows and macOS: "2026-11-20 1405 Title.md". */
export function minutesFileName(title: string, startedAt: number): string {
  const date = new Date(startedAt)
  const pad = (value: number): string => String(value).padStart(2, '0')
  const stamp = `${String(date.getFullYear())}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}${pad(date.getMinutes())}`
  const safe = title
    .replace(/[<>:"/\\|?*]/g, ' ')
    .split('')
    .filter((char) => char.charCodeAt(0) >= 32)
    .join('')
    .replace(/\s+/g, ' ')
    .replace(/[. ]+$/, '')
    .trim()
    .slice(0, 80)
  return `${stamp} ${safe === '' ? 'Meeting' : safe}.md`
}

/** Full export: minutes plus the transcript. */
export function exportMarkdown(title: string, startedAt: number, endedAt: number | null, minutes: string | null, lines: readonly MeetingLine[]): string {
  const head = minutesFile(title, startedAt, endedAt, minutes ?? '_No minutes yet._').trimEnd()
  return `${head}\n\n## Transcript\n\n${formatTranscript(lines, startedAt)
    .split('\n')
    .map((line) => `${line}  `)
    .join('\n')}\n`
}
