import { useEffect, useState } from 'react'
import type { KbHit, KbStatus } from '../../../shared/answers'
import { errorMessage, subscribe } from '../ipc'
import { Badge, Button, Card, ErrorBanner } from '../ui'

export function NotesPage() {
  const [status, setStatus] = useState<KbStatus | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [hits, setHits] = useState<KbHit[] | null>(null)

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

  const search = async (): Promise<void> => {
    setHits(await window.glimpse.invoke('kb:search', { query }))
  }

  if (status === null) return <div className="text-sm text-white/50">Loading notes…</div>
  const qa = status.files.reduce((sum, file) => sum + file.qaPairs, 0)

  return (
    <div className="space-y-5">
      <Card title="Your notes">
        <p className="mb-3 text-sm leading-relaxed text-white/70">
          Interview notes, prepared answers, your resume, the job description. Glimpse searches them before every answer and, when a
          question matches one of your prepared answers, shows it immediately. Files are copied into the notes folder shown below and
          never leave this PC except as short snippets sent with a question.
        </p>
        <code className="mb-3 block truncate rounded bg-ink px-2 py-1 text-xs text-white/70" title={status.folder}>
          {status.folder}
        </code>
        <div className="flex flex-wrap items-center gap-2">
          <Button onClick={() => void addFiles()}>Add files…</Button>
          <Button tone="ghost" onClick={() => void window.glimpse.invoke('kb:open-folder', null)}>
            Open notes folder
          </Button>
          <Button tone="ghost" onClick={() => void window.glimpse.invoke('kb:reindex', null).then(setStatus)}>
            Re-index
          </Button>
          <span className="ml-auto flex items-center gap-2 text-xs text-white/50">
            <Badge tone={status.state === 'error' ? 'bad' : status.state === 'indexing' ? 'warn' : 'good'}>{status.state}</Badge>
            {status.files.length} files · {status.chunks} passages · {qa} prepared answers · {status.semantic ? 'meaning + keyword search' : 'keyword search'}
          </span>
        </div>
        {message !== null && <p className="mt-3 text-xs text-emerald-300">{message}</p>}
        {error !== null && <ErrorBanner message={error} />}
        {status.message !== '' && <p className="mt-2 text-xs text-amber-300">{status.message}</p>}
        <p className="mt-3 text-xs text-white/45">
          Supported: .md .txt .docx .pdf .json .csv. Write prepared answers as “Q: … / A: …” lines, or a heading that ends with “?” followed by the answer.
        </p>
      </Card>

      <Card title="Indexed files">
        {status.files.length === 0 ? (
          <p className="text-sm text-white/45">No notes yet. Add files, or drop them into the notes folder.</p>
        ) : (
          <table className="w-full text-left text-sm">
            <tbody>
              {status.files.map((file) => (
                <tr key={file.name} className="border-t border-hairline first:border-t-0">
                  <td className="py-2 text-white">{file.name}</td>
                  <td className="py-2 text-xs text-white/55">
                    {file.error !== null ? <span className="text-red-300">{file.error}</span> : `${file.chunks} passages, ${file.qaPairs} prepared answers`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      <Card title="Test a search">
        <div className="flex gap-2">
          <input
            type="text"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value)
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && query.trim() !== '') void search()
            }}
            placeholder="e.g. Could you introduce yourself?"
            className="min-w-0 flex-1 rounded-md border border-hairline bg-ink px-3 py-1.5 text-sm text-white placeholder:text-white/30"
          />
          <Button onClick={() => void search()} disabled={query.trim() === ''}>
            Search
          </Button>
        </div>
        {hits !== null && (
          <ol className="mt-3 space-y-2">
            {hits.length === 0 && <li className="text-sm text-white/45">Nothing found.</li>}
            {hits.map((hit, index) => (
              <li key={`${hit.file}-${String(index)}`} className="rounded-lg border border-hairline bg-ink p-2.5 text-sm">
                <div className="mb-1 flex flex-wrap gap-2 text-xs text-white/50">
                  <span>{hit.file}</span>
                  {hit.kind === 'qa' && <Badge tone="good">prepared answer</Badge>}
                  {hit.similarity !== null && <span>similarity {hit.similarity.toFixed(2)}</span>}
                </div>
                {hit.question !== null && <div className="text-xs text-violet-300">{hit.question}</div>}
                <div className="line-clamp-3 text-white/80">{hit.text}</div>
              </li>
            ))}
          </ol>
        )}
      </Card>
    </div>
  )
}
