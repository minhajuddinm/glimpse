import { useEffect, useState } from 'react'
import { FileText, FilePlus2, FolderCog, FolderOpen, Library, RefreshCw, RotateCcw, Search, SearchX } from 'lucide-react'
import type { KbHit, KbStatus } from '../../../shared/answers'
import { errorMessage, subscribe } from '../ipc'
import { useSettingsStore } from '../store'
import { Badge, Button, Card, EmptyState, ErrorBanner, Loading, Notice, TextInput } from '../ui'

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div className="rounded-xl border border-hairline bg-white/[0.02] px-4 py-3">
      <div className="font-[family-name:var(--font-display)] text-[22px] font-semibold leading-none text-white">{value}</div>
      <div className="mt-1.5 text-[11px] text-text-faint">{label}</div>
    </div>
  )
}

export function NotesPage() {
  const [status, setStatus] = useState<KbStatus | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [hits, setHits] = useState<KbHit[] | null>(null)
  const { settings } = useSettingsStore()

  useEffect(() => {
    void window.glimpse.invoke('kb:status', null).then(setStatus)
    return subscribe('kb:status', setStatus)
  }, [])

  const addFiles = async (): Promise<void> => {
    setError(null)
    try {
      const result = await window.glimpse.invoke('kb:add-files', null)
      setStatus(result.status)
      if (result.added.length === 0 && result.skipped.length === 0) return
      setMessage(
        [
          result.added.length > 0 ? `Added ${result.added.join(', ')}.` : '',
          result.skipped.length > 0 ? `Skipped (unsupported type): ${result.skipped.join(', ')}.` : ''
        ]
          .filter((part) => part !== '')
          .join(' ')
      )
    } catch (caught) {
      setError(errorMessage(caught))
    }
  }

  const changeFolder = async (channel: 'kb:choose-folder' | 'kb:reset-folder'): Promise<void> => {
    setError(null)
    try {
      setStatus(await window.glimpse.invoke(channel, null))
      setMessage(null)
    } catch (caught) {
      setError(errorMessage(caught))
    }
  }

  const search = async (): Promise<void> => {
    if (query.trim() === '') return
    setHits(await window.glimpse.invoke('kb:search', { query }))
  }

  if (status === null) return <Loading label="Loading notes" />
  const qa = status.files.reduce((sum, file) => sum + file.qaPairs, 0)
  const custom = settings !== null && settings.notesFolder !== ''

  return (
    <>
      <Card
        title="Your notes folder"
        icon={Library}
        description="Interview notes, prepared answers, your resume, the job description. When a question matches a prepared answer, it appears instantly. Notes never leave this PC except as short snippets sent with a question."
        actions={
          <Badge tone={status.state === 'error' ? 'bad' : status.state === 'indexing' ? 'warn' : 'good'} dot={status.state === 'indexing'}>
            {status.state === 'indexing' ? 'Indexing…' : status.state === 'error' ? 'Error' : 'Up to date'}
          </Badge>
        }
      >
        <div className="mb-4 flex items-center gap-2.5 rounded-xl border border-hairline bg-ink/60 px-3.5 py-2.5">
          <FolderOpen className="h-4 w-4 shrink-0 text-violet-soft" aria-hidden />
          <code className="min-w-0 flex-1 truncate font-mono text-xs text-text" title={status.folder}>
            {status.folder}
          </code>
          {custom && <Badge tone="accent">Custom</Badge>}
        </div>

        <div className="mb-4 grid grid-cols-3 gap-2.5">
          <Stat value={String(status.files.length)} label="files" />
          <Stat value={String(qa)} label="prepared answers" />
          <Stat value={String(status.chunks)} label="searchable passages" />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button icon={FilePlus2} onClick={() => void addFiles()}>
            Add files…
          </Button>
          <Button tone="ghost" icon={FolderOpen} onClick={() => void window.glimpse.invoke('kb:open-folder', null)}>
            Open folder
          </Button>
          <Button tone="ghost" icon={FolderCog} onClick={() => void changeFolder('kb:choose-folder')}>
            Change folder…
          </Button>
          {custom && (
            <Button tone="subtle" icon={RotateCcw} onClick={() => void changeFolder('kb:reset-folder')}>
              Use default
            </Button>
          )}
          <span className="ml-auto">
            <Button tone="subtle" size="sm" icon={RefreshCw} onClick={() => void window.glimpse.invoke('kb:reindex', null).then(setStatus)}>
              Re-index
            </Button>
          </span>
        </div>

        {(message !== null || error !== null || status.message !== '') && (
          <div className="mt-4 space-y-2">
            {message !== null && <Notice tone="good">{message}</Notice>}
            {error !== null && <ErrorBanner message={error} />}
            {status.message !== '' && <Notice tone="warn">{status.message}</Notice>}
          </div>
        )}

        <p className="mt-4 text-xs leading-relaxed text-text-faint">
          {status.semantic ? 'Search understands meaning as well as keywords. ' : 'Keyword search. '}
          Supported: .md .txt .docx .pdf .json .csv. Write prepared answers as <span className="text-text-muted">“Q: … / A: …”</span>, or a heading ending in “?” followed by the answer.
        </p>
      </Card>

      <Card title="Indexed files" icon={FileText}>
        {status.files.length === 0 ? (
          <EmptyState icon={FilePlus2} title="No notes yet">
            Add files, or drop them into the notes folder — Glimpse picks them up automatically.
          </EmptyState>
        ) : (
          <ul className="divide-y divide-hairline">
            {status.files.map((file) => (
              <li key={file.name} className="flex items-center gap-3 py-2.5 first:pt-0 last:pb-0">
                <div className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-white/[0.04] text-text-faint">
                  <FileText className="h-4 w-4" aria-hidden />
                </div>
                <div className="min-w-0 flex-1 truncate text-[13px] text-white">{file.name}</div>
                {file.error !== null ? (
                  <Badge tone="bad">{file.error}</Badge>
                ) : (
                  <div className="flex shrink-0 gap-1.5">
                    {file.qaPairs > 0 && <Badge tone="accent">{file.qaPairs} answers</Badge>}
                    <Badge tone="neutral">{file.chunks} passages</Badge>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card title="Test a search" icon={Search} description="See what Glimpse would find in your notes for a question.">
        <div className="flex gap-2">
          <TextInput value={query} onChange={setQuery} onEnter={() => void search()} placeholder="e.g. Could you introduce yourself?" />
          <Button icon={Search} onClick={() => void search()} disabled={query.trim() === ''}>
            Search
          </Button>
        </div>
        {hits !== null && (
          <ol className="mt-4 space-y-2">
            {hits.length === 0 && (
              <li>
                <EmptyState icon={SearchX} title="Nothing relevant">
                  Glimpse would answer this from general knowledge.
                </EmptyState>
              </li>
            )}
            {hits.map((hit, index) => (
              <li key={`${hit.file}-${String(index)}`} className="animate-fade-up rounded-xl border border-hairline bg-white/[0.02] p-3.5">
                <div className="mb-1.5 flex flex-wrap items-center gap-2 text-[11px] text-text-faint">
                  <span className="text-text-muted">{hit.file}</span>
                  {hit.kind === 'qa' && <Badge tone="good">prepared answer</Badge>}
                  {hit.similarity !== null && (
                    <span className="ml-auto flex items-center gap-1.5">
                      <span className="h-1 w-16 overflow-hidden rounded-full bg-white/10">
                        <span className="brand-gradient block h-full" style={{ width: `${String(Math.round(Math.max(0, hit.similarity) * 100))}%` }} />
                      </span>
                      {Math.round(hit.similarity * 100)}% match
                    </span>
                  )}
                </div>
                {hit.question !== null && <div className="mb-0.5 text-[12.5px] font-medium text-violet-soft">{hit.question}</div>}
                <div className="line-clamp-3 text-[13px] leading-relaxed text-text">{hit.text}</div>
              </li>
            ))}
          </ol>
        )}
      </Card>
    </>
  )
}
