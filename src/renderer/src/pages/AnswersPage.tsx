import { useEffect, useState } from 'react'
import type { AnswersSnapshot, KeyStatus } from '../../../shared/answers'
import { errorMessage, subscribe } from '../ipc'
import { useSettingsStore } from '../store'
import { Badge, Button, Card, ErrorBanner, Row } from '../ui'

function KeyRow({ label, hint, provider, saved, onSaved }: { label: string; hint: string; provider: 'anthropic' | 'groq'; saved: boolean; onSaved: (status: KeyStatus) => void }) {
  const [value, setValue] = useState('')
  const [error, setError] = useState<string | null>(null)
  const save = async (key: string): Promise<void> => {
    try {
      onSaved(await window.glimpse.invoke('keys:set', { provider, key }))
      setValue('')
      setError(null)
    } catch (caught) {
      setError(errorMessage(caught))
    }
  }
  return (
    <div className="border-b border-hairline py-4 last:border-b-0">
      <div className="mb-2 flex items-center gap-2">
        <span className="text-sm font-medium text-white">{label}</span>
        <Badge tone={saved ? 'good' : 'neutral'}>{saved ? 'saved' : 'not set'}</Badge>
      </div>
      <p className="mb-2 text-xs text-white/50">{hint}</p>
      <div className="flex gap-2">
        <input
          type="password"
          autoComplete="off"
          spellCheck={false}
          placeholder={saved ? 'Paste a new key to replace it' : 'Paste your API key'}
          value={value}
          onChange={(event) => {
            setValue(event.target.value)
          }}
          className="min-w-0 flex-1 rounded-md border border-hairline bg-ink px-3 py-1.5 font-mono text-xs text-white placeholder:text-white/30"
        />
        <Button onClick={() => void save(value)} disabled={value.trim() === ''}>
          Save
        </Button>
        {saved && (
          <Button tone="ghost" onClick={() => void save('')}>
            Remove
          </Button>
        )}
      </div>
      {error !== null && <p className="mt-2 text-xs text-red-300">{error}</p>}
    </div>
  )
}

export function AnswersPage() {
  const { settings, update } = useSettingsStore()
  const [keys, setKeys] = useState<KeyStatus | null>(null)
  const [context, setContext] = useState('')
  const [contextSaved, setContextSaved] = useState(true)
  const [question, setQuestion] = useState('')
  const [answers, setAnswers] = useState<AnswersSnapshot>({ answers: [] })
  const [asked, setAsked] = useState<string | null>(null)
  const ask = (): void => {
    const text = question.trim()
    if (text === '') return
    setAsked(text)
    void window.glimpse.invoke('answers:ask', { question: text })
  }

  useEffect(() => {
    void window.glimpse.invoke('keys:status', null).then(setKeys)
    void window.glimpse.invoke('context:get', null).then(setContext)
    void window.glimpse.invoke('answers:get', null).then(setAnswers)
    return subscribe('answers:update', setAnswers)
  }, [])

  if (settings === null || keys === null) return <div className="text-sm text-white/50">Loading…</div>
  // Show the answer to what was typed here, not a newer auto-answer from the live call.
  const latest = asked === null ? undefined : answers.answers.find((answer) => answer.status !== 'cancelled' && answer.question === asked)

  return (
    <div className="space-y-5">
      <Card title="Answer provider">
        {!keys.encryptionAvailable && <ErrorBanner message="Windows cannot encrypt secrets on this account, so API keys cannot be saved." />}
        <KeyRow
          label="Anthropic (Claude)"
          hint="Best answers. Claude Haiku 5.5 for live answers, Sonnet 5.5 for “elaborate”. Roughly $0.04 per hour of calls. Create a key at console.anthropic.com."
          provider="anthropic"
          saved={keys.anthropic}
          onSaved={setKeys}
        />
        <KeyRow
          label="Groq (free tier)"
          hint="Free fallback (gpt-oss-120b), about 2–4 answers a minute. Less careful than Claude: it may invent personal details, so add your notes and background. Create a key at console.groq.com."
          provider="groq"
          saved={keys.groq}
          onSaved={setKeys}
        />
        <Row label="Use" hint="Auto uses Claude when its key is saved, otherwise Groq">
          <select
            className="rounded-md border border-hairline bg-ink px-3 py-1.5 text-sm text-white"
            value={settings.llmProvider}
            onChange={(event) => {
              const value = event.target.value
              if (value === 'auto' || value === 'anthropic' || value === 'groq') void update({ llmProvider: value })
            }}
          >
            <option value="auto">Auto</option>
            <option value="anthropic">Anthropic only</option>
            <option value="groq">Groq only</option>
          </select>
        </Row>
        <p className="pt-3 text-xs text-white/45">
          Keys are encrypted with Windows (DPAPI) and stay on this PC. Only the recent transcript and matching note snippets are sent, to the provider you choose. Without a key, Glimpse still shows prepared answers from your notes.
        </p>
      </Card>

      <Card title="When to answer">
        <Row label="Answer automatically" hint="When the other side asks a question, answer without a key press">
          <input type="checkbox" className="h-4 w-4 accent-violet" checked={settings.autoAnswer} onChange={(event) => void update({ autoAnswer: event.target.checked })} />
        </Row>
        <Row label="Fact-check claims" hint="Flag numbers, dates and names the other side states (✓ ✗ ⚠)">
          <input type="checkbox" className="h-4 w-4 accent-violet" checked={settings.factCheck} onChange={(event) => void update({ factCheck: event.target.checked })} />
        </Row>
      </Card>

      <Card title="About you (resume, job description, goals)">
        <p className="mb-2 text-xs text-white/50">Glimpse uses this in every answer. Your notes folder is searched separately for each question.</p>
        <textarea
          rows={7}
          maxLength={20000}
          value={context}
          onChange={(event) => {
            setContext(event.target.value)
            setContextSaved(false)
          }}
          placeholder="e.g. Final-year software engineering student. Interning at … Interviewing for a backend role at …"
          className="w-full resize-y rounded-md border border-hairline bg-ink px-3 py-2 text-sm text-white placeholder:text-white/30"
        />
        <div className="mt-2 flex items-center gap-3">
          <Button onClick={() => void window.glimpse.invoke('context:set', context).then(() => { setContextSaved(true) })} disabled={contextSaved}>
            {contextSaved ? 'Saved' : 'Save'}
          </Button>
          <span className="text-xs text-white/40">{context.length.toLocaleString()} / 20,000 characters</span>
        </div>
      </Card>

      <Card title="Try it">
        <div className="flex gap-2">
          <input
            type="text"
            value={question}
            maxLength={500}
            onChange={(event) => {
              setQuestion(event.target.value)
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') ask()
            }}
            placeholder="Type a question the other side might ask"
            className="min-w-0 flex-1 rounded-md border border-hairline bg-ink px-3 py-1.5 text-sm text-white placeholder:text-white/30"
          />
          <Button onClick={ask} disabled={question.trim() === ''}>
            Ask
          </Button>
        </div>
        {latest !== undefined && (
          <div className="mt-4 rounded-lg border border-hairline bg-ink p-3">
            <div className="mb-1 flex flex-wrap items-center gap-2 text-xs text-white/50">
              <Badge tone={latest.status === 'error' ? 'bad' : latest.status === 'done' ? 'good' : 'warn'}>{latest.status}</Badge>
              <span>
                {latest.origin === 'notes' ? 'from your notes' : latest.origin === 'notes+model' ? `${latest.model ?? 'model'} + your notes` : latest.model ?? ''}
              </span>
              {latest.firstTextAt !== null && <span>first words after {Math.max(0, latest.firstTextAt - latest.askedAt)} ms</span>}
            </div>
            <p className="whitespace-pre-wrap text-sm text-white">{latest.status === 'error' ? latest.error : latest.text || '…'}</p>
            {latest.sources.length > 0 && <p className="mt-1 text-xs text-white/40">Notes: {latest.sources.join(', ')}</p>}
          </div>
        )}
      </Card>
    </div>
  )
}
