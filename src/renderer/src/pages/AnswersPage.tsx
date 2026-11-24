import { useEffect, useState } from 'react'
import { Bot, CheckCircle2, KeyRound, Send, ShieldCheck, Sparkles, UserRound, Zap } from 'lucide-react'
import type { AnswersSnapshot, KeyStatus } from '../../../shared/answers'
import { errorMessage, subscribe } from '../ipc'
import { IS_MAC, OS_NAME } from '../platform'
import { useSettingsStore } from '../store'
import { Badge, Button, Card, ErrorBanner, Loading, Notice, Row, Select, TextArea, TextInput, Toggle } from '../ui'

function KeyRow({
  label,
  hint,
  provider,
  saved,
  onSaved,
  recommended = false
}: {
  label: string
  hint: string
  provider: 'anthropic' | 'groq'
  saved: boolean
  onSaved: (status: KeyStatus) => void
  recommended?: boolean
}) {
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
    <div className={`rounded-xl border p-4 transition ${saved ? 'border-emerald-400/20 bg-emerald-400/[0.03]' : 'border-hairline bg-white/[0.015]'}`}>
      <div className="mb-1 flex items-center gap-2">
        <span className="text-[13.5px] font-semibold text-white">{label}</span>
        {recommended && <Badge tone="accent">Recommended</Badge>}
        <span className="ml-auto">
          {saved ? (
            <Badge tone="good" dot>
              Key saved
            </Badge>
          ) : (
            <Badge tone="neutral">Not set</Badge>
          )}
        </span>
      </div>
      <p className="mb-3 text-xs leading-relaxed text-text-faint">{hint}</p>
      <div className="flex gap-2">
        <TextInput
          type="password"
          mono
          value={value}
          onChange={setValue}
          onEnter={() => {
            if (value.trim() !== '') void save(value)
          }}
          placeholder={saved ? 'Paste a new key to replace it' : 'Paste your API key'}
          aria-label={`${label} API key`}
        />
        <Button icon={KeyRound} onClick={() => void save(value)} disabled={value.trim() === ''}>
          Save
        </Button>
        {saved && (
          <Button tone="subtle" onClick={() => void save('')}>
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

  if (settings === null || keys === null) return <Loading label="Loading answer settings" />
  // Show the answer to what was typed here, not a newer auto-answer from the live call.
  const latest = asked === null ? undefined : answers.answers.find((answer) => answer.status !== 'cancelled' && answer.question === asked)
  const words = latest === undefined ? 0 : latest.text.split(/\s+/).filter((word) => word.length > 0).length

  return (
    <>
      <Card title="AI provider" icon={Bot} description="Bring your own key. Glimpse has no server: questions go straight from this PC to the provider you choose.">
        {!keys.encryptionAvailable && <ErrorBanner message={`${OS_NAME} cannot encrypt secrets on this account, so API keys cannot be saved.`} />}
        <div className="space-y-3">
          <KeyRow
            label="Anthropic · Claude"
            recommended
            hint="Most accurate, follows your notes closely. Haiku 5.5 for live answers, Sonnet 5.5 for “elaborate”. About $0.04 per hour of calls — key from console.anthropic.com → API Keys."
            provider="anthropic"
            saved={keys.anthropic}
            onSaved={setKeys}
          />
          <KeyRow
            label="Groq · free tier"
            hint="Free and very fast (gpt-oss-120b), about 2–4 answers a minute. Less careful: it may invent personal details, so add your notes and background. Key from console.groq.com."
            provider="groq"
            saved={keys.groq}
            onSaved={setKeys}
          />
        </div>
        <div className="mt-4 border-t border-hairline pt-4">
          <Row label="Use" hint="Auto prefers Claude when its key is saved, otherwise Groq">
            <Select
              value={settings.llmProvider}
              options={[
                { value: 'auto', label: 'Auto' },
                { value: 'anthropic', label: 'Anthropic only' },
                { value: 'groq', label: 'Groq only' }
              ]}
              onChange={(value) => void update({ llmProvider: value })}
            />
          </Row>
        </div>
        <div className="mt-4 flex items-start gap-2 text-xs leading-relaxed text-text-faint">
          <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-300/80" aria-hidden />
          Keys are encrypted by {IS_MAC ? "your macOS Keychain" : "Windows"} and only leave this computer to authenticate with the provider. Only the recent transcript and matching note snippets are sent. Without a key, prepared answers from your notes still work.
        </div>
      </Card>

      <Card title="When to answer" icon={Zap}>
        <Row label="Answer automatically" hint="When the other side asks a question, answer without pressing anything">
          <Toggle checked={settings.autoAnswer} onChange={(checked) => void update({ autoAnswer: checked })} />
        </Row>
        <Row label="Fact-check claims" hint="Flag numbers, dates and names the other side states (✓ ✗ ⚠)">
          <Toggle checked={settings.factCheck} onChange={(checked) => void update({ factCheck: checked })} />
        </Row>
      </Card>

      <Card
        title="About you"
        icon={UserRound}
        description="Resume, the job description, your goals. Used in every answer; your notes folder is searched separately for each question."
        actions={
          <Button
            size="sm"
            tone={contextSaved ? 'ghost' : 'primary'}
            icon={contextSaved ? CheckCircle2 : undefined}
            disabled={contextSaved}
            onClick={() =>
              void window.glimpse.invoke('context:set', context).then(() => {
                setContextSaved(true)
              })
            }
          >
            {contextSaved ? 'Saved' : 'Save'}
          </Button>
        }
      >
        <TextArea
          rows={7}
          maxLength={20000}
          value={context}
          onChange={(value) => {
            setContext(value)
            setContextSaved(false)
          }}
          placeholder="e.g. Final-year software engineering student. Interned at … on payments. Interviewing for a backend role at …"
          aria-label="About you"
        />
        <div className="mt-1.5 text-right text-[11px] text-text-faint">{context.length.toLocaleString()} / 20,000</div>
      </Card>

      <Card title="Try it" icon={Sparkles} description="Ask the kind of question the other side might ask and see what Glimpse would show.">
        <div className="flex gap-2">
          <TextInput value={question} maxLength={500} onChange={setQuestion} onEnter={ask} placeholder="e.g. Walk me through a project you're proud of" />
          <Button icon={Send} onClick={ask} disabled={question.trim() === ''}>
            Ask
          </Button>
        </div>
        {latest !== undefined && (
          <div className="mt-4 animate-fade-up rounded-xl border border-violet/25 bg-violet/[0.05] p-4">
            <div className="mb-2 flex flex-wrap items-center gap-2 text-[11px] text-text-faint">
              <Badge tone={latest.status === 'error' ? 'bad' : latest.status === 'done' ? 'good' : 'accent'} dot={latest.status === 'streaming'}>
                {latest.status}
              </Badge>
              <span>
                {latest.origin === 'notes' ? 'from your notes' : latest.origin === 'notes+model' ? `${latest.model ?? 'model'} + your notes` : (latest.model ?? '')}
              </span>
              {latest.firstTextAt !== null && <span>· first words in {Math.max(0, latest.firstTextAt - latest.askedAt)} ms</span>}
              {words > 0 && <span>· {words} words</span>}
            </div>
            {latest.status === 'thinking' && latest.text === '' ? (
              <div className="space-y-2" aria-label="Thinking">
                <div className="skeleton h-3.5 w-11/12 rounded" />
                <div className="skeleton h-3.5 w-3/4 rounded" />
              </div>
            ) : (
              <p className={`whitespace-pre-wrap text-[15px] leading-relaxed ${latest.status === 'error' ? 'text-red-300' : 'text-white'}`}>
                {latest.status === 'error' ? latest.error : latest.text}
              </p>
            )}
          </div>
        )}
        {latest === undefined && !keys.anthropic && !keys.groq && (
          <div className="mt-4">
            <Notice>Add a key above to get model answers. Questions that match your prepared notes are answered even without one.</Notice>
          </div>
        )}
      </Card>
    </>
  )
}
