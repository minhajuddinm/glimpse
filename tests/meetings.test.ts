import { describe, expect, it } from 'vitest'
import { openDatabase } from '../src/main/db'
import type { LlmCall, LlmProvider } from '../src/main/answers/llm'
import { MeetingManager, MIN_WORDS_FOR_MINUTES, type MeetingFiles } from '../src/main/meetings/manager'
import { cleanMinutes, formatTranscript, minutesFileName, splitTranscript } from '../src/main/meetings/minutes'
import { MeetingStore, minutesPreview } from '../src/main/meetings/store'
import { defaultMeetingTitle, formatDuration } from '../src/shared/meetings'
import type { Segment, Source } from '../src/shared/transcript'

const MINUTES = `## Summary
Agreed the pilot.
## Decisions
- Start in March.
## Action items
- [ ] You — send the contract (Friday)
## Open questions
- None recorded.
## Key details
- Price: $40k.`

function fakeProvider(id: LlmProvider['id'], reply: (call: LlmCall) => string = () => MINUTES): LlmProvider & { calls: LlmCall[] } {
  const calls: LlmCall[] = []
  return {
    id,
    calls,
    model: () => `${id}-model`,
    stream: (call) => {
      calls.push(call)
      return Promise.resolve(reply(call))
    }
  }
}

function memoryFiles(): MeetingFiles & { saved: Map<string, string> } {
  const saved = new Map<string, string>()
  return {
    saved,
    write: (name, contents) => {
      const path = `/notes/Meetings/${name}`
      saved.set(path, contents)
      return Promise.resolve(path)
    },
    remove: (path) => {
      saved.delete(path)
      return Promise.resolve()
    }
  }
}

function setup(provider: LlmProvider | null = fakeProvider('anthropic')) {
  const store = new MeetingStore(openDatabase(':memory:'))
  const files = memoryFiles()
  let clock = Date.UTC(2026, 10, 20, 14, 5)
  const manager = new MeetingManager({
    store,
    provider: () => provider,
    context: () => '',
    files,
    now: () => clock,
    onState: () => undefined,
    onListChanged: () => undefined
  })
  let id = 1
  const say = (source: Source, text: string): void => {
    clock += 5000
    const segment: Segment = { id: id++, source, text, at: clock, latencyMs: null }
    manager.onSegment(segment)
  }
  return { store, files, manager, say, tick: (ms: number) => (clock += ms) }
}

const LONG_LINE = 'we should start the pilot in march and send the contract by friday with the forty thousand price'

async function settle(manager: MeetingManager, id: number): Promise<void> {
  await manager.summarize(id)
}

describe('meeting minutes helpers', () => {
  it('joins consecutive lines from one side and stamps the time', () => {
    const start = 1_000_000
    const text = formatTranscript(
      [
        { source: 'them', text: 'Hello.', at: start + 2000 },
        { source: 'them', text: 'Can you hear me?', at: start + 4000 },
        { source: 'you', text: 'Yes.', at: start + 65_000 }
      ],
      start
    )
    expect(text).toBe('[00:02] Them: Hello. Can you hear me?\n[01:05] You: Yes.')
  })

  it('splits a long transcript at line boundaries', () => {
    const lines = Array.from({ length: 40 }, (_, index) => `[00:00] Them: ${LONG_LINE} ${String(index)}`).join('\n')
    const parts = splitTranscript(lines, 200)
    expect(parts.length).toBeGreaterThan(1)
    expect(parts.join('\n')).toBe(lines)
    expect(splitTranscript('short', 200)).toEqual(['short'])
  })

  it('cleans fences and preambles and rejects minutes without a summary', () => {
    expect(cleanMinutes('```markdown\nHere you go:\n## Summary\nOk.\n```')).toBe('## Summary\nOk.')
    expect(() => cleanMinutes('Sorry, I cannot.')).toThrow(/Summary/)
  })

  it('makes safe file names and plain previews', () => {
    const at = new Date(2026, 10, 20, 9, 7).getTime()
    expect(minutesFileName('Acme: pricing / Q4?', at)).toBe('2026-11-20 0907 Acme pricing Q4.md')
    expect(minutesFileName('...', at)).toBe('2026-11-20 0907 Meeting.md')
    expect(minutesPreview(MINUTES)).toMatch(/^Agreed the pilot\. Start in March\./)
    expect(formatDuration(3_725_000)).toBe('1:02:05')
    expect(defaultMeetingTitle(at)).toMatch(/^Meeting · /)
  })
})

describe('MeetingManager', () => {
  it('saves lines only while a meeting runs, then writes minutes and the notes file', async () => {
    const { manager, store, files, say } = setup()
    say('them', 'said before the meeting')
    const id = manager.start('Acme pricing').active?.id ?? -1
    say('them', LONG_LINE)
    say('you', LONG_LINE)
    expect(manager.state().active?.lines).toBe(2)
    manager.stop()
    say('them', 'said after the meeting')
    await settle(manager, id)

    const detail = store.detail(id)
    expect(detail?.transcript.map((line) => line.source)).toEqual(['them', 'you'])
    expect(detail?.status).toBe('done')
    expect(detail?.minutes).toBe(MINUTES)
    expect(detail?.model).toBe('anthropic-model')
    expect(detail?.file).toMatch(/Acme pricing\.md$/)
    expect(files.saved.get(detail?.file ?? '')).toContain('# Acme pricing')
    expect(manager.active).toBe(false)
  })

  it('does not write minutes on stop when almost nothing was said', async () => {
    const provider = fakeProvider('anthropic')
    const { manager, store, say } = setup(provider)
    const id = manager.start().active?.id ?? -1
    say('you', 'testing one two')
    manager.stop()
    await Promise.resolve()
    expect(provider.calls).toHaveLength(0)
    expect(store.detail(id)?.status).toBe('error')
    expect(store.detail(id)?.error).toMatch(/Too little/)
    expect(MIN_WORDS_FOR_MINUTES).toBeGreaterThan(3)
  })

  it('keeps the transcript and explains when there is no API key', async () => {
    const { manager, store, say } = setup(null)
    const id = manager.start().active?.id ?? -1
    say('them', LONG_LINE)
    say('them', LONG_LINE)
    manager.stop()
    await settle(manager, id)
    expect(store.detail(id)?.status).toBe('error')
    expect(store.detail(id)?.error).toMatch(/key/)
    expect(store.lines(id)).toHaveLength(2)
  })

  it('records a model failure as an error that can be retried', async () => {
    let fail = true
    const provider = fakeProvider('anthropic', () => {
      if (fail) throw new Error('overloaded')
      return MINUTES
    })
    const { manager, store, say } = setup(provider)
    const id = manager.start().active?.id ?? -1
    say('them', LONG_LINE)
    manager.stop()
    await settle(manager, id)
    expect(store.detail(id)?.error).toMatch(/overloaded/)
    fail = false
    await manager.summarize(id)
    expect(store.detail(id)?.status).toBe('done')
  })

  it('summarises a long meeting in parts on Groq, then merges', async () => {
    const provider = fakeProvider('groq')
    const { manager, say } = setup(provider)
    const id = manager.start().active?.id ?? -1
    // ~26 tokens per line, alternating sides so lines are not joined: well over Groq's 4,500-token part size.
    for (let index = 0; index < 400; index++) say(index % 2 === 0 ? 'them' : 'you', LONG_LINE)
    manager.stop()
    await settle(manager, id)
    expect(provider.calls.length).toBeGreaterThan(2)
    expect(provider.calls.at(-1)?.user).toMatch(/Merge them/)
    expect(provider.calls.every((call) => call.deep)).toBe(true)
  })

  it('marks a meeting left open by a crash as interrupted, and on quit', () => {
    const { manager, store, say } = setup()
    const crashed = manager.start('Crashed').active?.id ?? -1
    say('them', LONG_LINE)
    // A new manager on the same database, as after a restart.
    const restarted = new MeetingManager({
      store,
      provider: () => null,
      context: () => '',
      files: memoryFiles(),
      now: () => Date.now(),
      onState: () => undefined,
      onListChanged: () => undefined
    })
    restarted.init()
    expect(store.detail(crashed)?.status).toBe('interrupted')
    expect(store.detail(crashed)?.endedAt).not.toBeNull()

    const quitting = restarted.start('Quit').active?.id ?? -1
    restarted.shutdown()
    expect(store.detail(quitting)?.status).toBe('interrupted')
    expect(restarted.active).toBe(false)
  })

  it('deletes a meeting with its lines and its notes file', async () => {
    const { manager, store, files, say } = setup()
    const id = manager.start('Delete me').active?.id ?? -1
    say('them', LONG_LINE)
    manager.stop()
    await settle(manager, id)
    expect(files.saved.size).toBe(1)
    await manager.delete(id)
    expect(store.detail(id)).toBeNull()
    expect(store.lines(id)).toHaveLength(0)
    expect(files.saved.size).toBe(0)
  })

  it('refuses to delete the meeting being recorded', async () => {
    const { manager } = setup()
    const id = manager.start().active?.id ?? -1
    await expect(manager.delete(id)).rejects.toThrow(/Stop/)
  })
})
