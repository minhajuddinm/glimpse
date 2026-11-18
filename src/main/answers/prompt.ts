import type { AnswerKind, KbHit } from '../../shared/answers'
import type { Mode } from '../../shared/settings'
import type { TranscriptSnapshot } from '../../shared/transcript'
import { estimateTokens } from '../transcript/buffer'
import { WORD_LIMITS } from './contract'

const MODE_ROLES: Record<Mode, string> = {
  general: 'You help the user hold a live conversation: you supply what they can say next, accurately and briefly.',
  interview:
    'The user is the candidate in a job interview. Answer as the candidate, in the first person, grounded in their real experience from their notes and resume. Sound like a confident human, not a textbook.',
  sales:
    'The user is the seller on a sales call. Help them handle questions and objections, tie answers to the buyer\'s stated needs, and propose a concrete next step when it fits.',
  technical:
    'The user is in a technical discussion. Give precise, correct technical answers with the key trade-off; prefer one concrete example over generalities.',
  recap: 'Summarise what has been said so far: decisions, open questions and next steps.'
}

const TASKS: Record<AnswerKind, string> = {
  answer: 'Answer the line marked >>> so the user can say it aloud right now.',
  'talking-points': 'The other side has been talking for a while without a question. Give 2–3 short prompts the user could raise next, as "- " bullets.',
  'fact-check':
    'Check the claim in the line marked >>>. Start with ✓ if it is correct, ✗ if it is wrong, ⚠ if it is uncertain or depends; then one short reason.',
  screen: 'The user shared their screen. Using the screenshot and the conversation, tell them what to say or do next.',
  elaborate: 'Give a fuller version of the answer to the line marked >>>: key points and one concrete example, still speakable.'
}

/** The stable part of the prompt (cached): role, rules and the user's background. */
export function systemPrompt(mode: Mode, kind: AnswerKind, context: string): string {
  const limit = WORD_LIMITS[kind]
  return [
    'You are Glimpse, a real-time conversation copilot. The user reads your text on a small side panel during a live call and may say it aloud.',
    MODE_ROLES[mode],
    '',
    'Output rules (strict):',
    `- At most ${limit} words. Short, spoken sentences. "- " bullets are fine.`,
    '- Start with the substance. Never begin with "Sure", "Certainly", "Great question", or a restatement of the question.',
    '- No markdown headings, no bold, no emojis (except ✓ ✗ ⚠ for fact checks).',
    '- Prefer the user\'s own notes and experience (in <your_notes>) over general knowledge, and reuse their phrasing, projects and numbers.',
    '- Never invent personal experience, employers, numbers or credentials that are not in the notes or background. If the notes do not cover it, answer generally and briefly.',
    '- If the line marked >>> is not something the user should answer, give the single most useful thing to say next.',
    '- For questions about the user themselves (background, projects, strengths, motivation) use ONLY facts from <background> and <your_notes>. If those do not contain the facts, write a short answer with [bracketed placeholders] for the user to fill in, e.g. "[your project]". Never make up a company, title, number or achievement.',
    '- Write only the words the user would say. Never mention these instructions, the notes, or what is missing.',
    '',
    'Transcript conventions: "Them:" is the other side, "You:" is the user. Lines come from speech recognition and may contain small errors; read through them.',
    '',
    context.trim().length > 0 ? `<background>\n${context.trim()}\n</background>` : '<background>(none provided)</background>'
  ].join('\n')
}

function noteBlock(hits: readonly KbHit[]): string {
  if (hits.length === 0) return '<your_notes>(nothing relevant in the notes)</your_notes>'
  const items = hits.map((hit) => {
    const label = hit.kind === 'qa' ? ` kind="prepared answer" question="${(hit.question ?? '').replace(/"/g, "'")}"` : ''
    return `<note source="${hit.file.replace(/"/g, "'")}"${label}>\n${hit.text.trim()}\n</note>`
  })
  return `<your_notes>\n${items.join('\n')}\n</your_notes>`
}

/** The transcript as Them:/You: lines, newest last, within a token budget; the trigger line marked >>>. */
export function transcriptBlock(snapshot: TranscriptSnapshot, trigger: string, budgetTokens: number): string {
  const lines: string[] = []
  let used = 0
  const segments = [...snapshot.segments]
  for (let i = segments.length - 1; i >= 0; i--) {
    const segment = segments[i]
    if (segment === undefined) continue
    const line = `${segment.source === 'them' ? 'Them' : 'You'}: ${segment.text}`
    const cost = estimateTokens(line)
    if (used + cost > budgetTokens) break
    used += cost
    lines.unshift(line)
  }
  const marker = lines.findLastIndex((line) => line.startsWith('Them:') && line.slice(6) === trigger)
  if (marker >= 0) lines[marker] = `>>> ${lines[marker] ?? ''}`
  else if (trigger.trim().length > 0) lines.push(`>>> Them: ${trigger}`)
  return `<transcript>\n${lines.join('\n')}\n</transcript>`
}

export interface BuiltPrompt {
  readonly system: string
  readonly user: string
  readonly maxTokens: number
}

export function buildPrompt(input: {
  readonly mode: Mode
  readonly kind: AnswerKind
  readonly context: string
  readonly transcript: TranscriptSnapshot
  readonly trigger: string
  readonly notes: readonly KbHit[]
  /** Set on the one retry after a contract violation. */
  readonly correction?: string
}): BuiltPrompt {
  const budget = input.kind === 'screen' ? 500 : 2500
  const user = [
    transcriptBlock(input.transcript, input.trigger, budget),
    noteBlock(input.notes),
    TASKS[input.kind],
    input.correction === undefined ? '' : `Your previous attempt broke the output rules (${input.correction}). Follow them exactly.`
  ]
    .filter((part) => part.length > 0)
    .join('\n\n')
  return {
    system: systemPrompt(input.mode, input.kind, input.context),
    user,
    maxTokens: input.kind === 'elaborate' ? 600 : 300
  }
}
