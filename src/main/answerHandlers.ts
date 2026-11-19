import { desktopCapturer, dialog, screen, shell, BrowserWindow } from 'electron'
import type { AnswersSnapshot, KbStatus, KeyStatus } from '../shared/answers'
import type { AnswerService } from './answers/service'
import { registerHandler } from './ipc'
import type { KnowledgeBase } from './kb/manager'
import { SUPPORTED_EXTENSIONS } from './kb/parsers'
import type { SecretStore } from './secrets'
import { isTrustedSender } from './security'
import type { SettingsStore } from './settingsStore'
import { dataPaths, installFolder } from './paths'
import { relative, isAbsolute } from 'node:path'

/** Rejects folders the uninstaller or an update would delete. */
function checkNotesFolder(folder: string): void {
  const install = installFolder()
  if (install === null) return
  const rel = relative(install, folder)
  if (rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))) {
    throw new Error('Pick a folder outside the Glimpse install folder: uninstalling or updating Glimpse deletes everything in it.')
  }
}

export interface AnswerHandlerContext {
  readonly settings: SettingsStore
  /** Null in headless runs. */
  readonly answers: AnswerService | null
  readonly kb: KnowledgeBase | null
  readonly secrets: SecretStore | null
  readonly onKeysChanged: () => void
}

const CONTEXT_KEY = 'answerContext'

/** A JPEG (base64) of the primary display, at most 1280 px wide, kept in memory only (C7). */
export async function screenshotJpeg(maxWidth = 1280): Promise<string | null> {
  const display = screen.getPrimaryDisplay()
  const { width, height } = display.size
  const scale = Math.min(1, maxWidth / width)
  const sources = await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize: { width: Math.round(width * scale), height: Math.round(height * scale) }
  })
  const source = sources.find((candidate) => candidate.display_id === String(display.id)) ?? sources[0]
  if (source === undefined || source.thumbnail.isEmpty()) return null
  return source.thumbnail.toJPEG(80).toString('base64')
}

export function readContext(settings: SettingsStore): string {
  return settings.getRaw(CONTEXT_KEY) ?? ''
}

function keyStatus(secrets: SecretStore | null): KeyStatus {
  return {
    anthropic: secrets?.has('anthropic') ?? false,
    groq: secrets?.has('groq') ?? false,
    encryptionAvailable: secrets?.available ?? false
  }
}

const EMPTY_KB: KbStatus = { folder: '', state: 'idle', files: [], chunks: 0, semantic: false, lastIndexedAt: null, message: 'Off.' }
const NO_ANSWERS: AnswersSnapshot = { answers: [] }

export function registerAnswerHandlers(ctx: AnswerHandlerContext): void {
  const { settings, answers, kb, secrets } = ctx

  registerHandler('keys:status', isTrustedSender, () => keyStatus(secrets))
  registerHandler('keys:set', isTrustedSender, async ({ provider, key }) => {
    if (secrets === null) throw new Error('Keys cannot be stored in this mode.')
    await secrets.set(provider, key)
    ctx.onKeysChanged()
    return keyStatus(secrets)
  })

  registerHandler('context:get', isTrustedSender, () => readContext(settings))
  registerHandler('context:set', isTrustedSender, (text) => {
    settings.setRaw(CONTEXT_KEY, text)
    return null
  })

  registerHandler('answers:get', isTrustedSender, () => answers?.snapshot() ?? NO_ANSWERS)
  registerHandler('answers:ask', isTrustedSender, ({ question }) => {
    void answers?.ask(question)
    return null
  })
  registerHandler('answers:action', isTrustedSender, async ({ action }) => {
    if (answers === null) return null
    if (action === 'answer-now') void answers.ask()
    else if (action === 'elaborate') void answers.elaborate()
    else if (action === 'regenerate') void answers.regenerate()
    else if (action === 'clear') answers.clear()
    else {
      const image = await screenshotJpeg()
      if (image !== null) void answers.ask(undefined, 'answer', image)
    }
    return null
  })
  registerHandler('answers:retry', isTrustedSender, ({ id }) => {
    void answers?.retry(id)
    return null
  })

  registerHandler('kb:status', isTrustedSender, () => kb?.status() ?? EMPTY_KB)
  registerHandler('kb:add-files', isTrustedSender, async (_request, event) => {
    if (kb === null) return { added: [], skipped: [], status: EMPTY_KB }
    const owner = BrowserWindow.fromWebContents(event.sender)
    const options = {
      title: 'Add notes to Glimpse',
      buttonLabel: 'Add to notes',
      properties: ['openFile', 'multiSelections'] as ('openFile' | 'multiSelections')[],
      filters: [{ name: 'Notes', extensions: SUPPORTED_EXTENSIONS.map((extension) => extension.slice(1)) }]
    }
    const result = owner === null ? await dialog.showOpenDialog(options) : await dialog.showOpenDialog(owner, options)
    if (result.canceled || result.filePaths.length === 0) return { added: [], skipped: [], status: kb.status() }
    const { added, skipped } = await kb.addFiles(result.filePaths)
    return { added, skipped, status: kb.status() }
  })
  registerHandler('kb:choose-folder', isTrustedSender, async (_request, event) => {
    if (kb === null) return EMPTY_KB
    const owner = BrowserWindow.fromWebContents(event.sender)
    const options = { title: 'Choose your notes folder', buttonLabel: 'Use this folder', defaultPath: kb.folder, properties: ['openDirectory', 'createDirectory'] as ('openDirectory' | 'createDirectory')[] }
    const result = owner === null ? await dialog.showOpenDialog(options) : await dialog.showOpenDialog(owner, options)
    const folder = result.filePaths[0]
    if (result.canceled || folder === undefined) return kb.status()
    checkNotesFolder(folder)
    settings.update({ notesFolder: folder })
    await kb.setFolder(folder)
    return kb.status()
  })
  registerHandler('kb:reset-folder', isTrustedSender, async () => {
    if (kb === null) return EMPTY_KB
    settings.update({ notesFolder: '' })
    await kb.setFolder(dataPaths().defaultNotes)
    return kb.status()
  })
  registerHandler('kb:open-folder', isTrustedSender, async () => {
    if (kb !== null) await shell.openPath(kb.folder)
    return null
  })
  registerHandler('kb:reindex', isTrustedSender, async () => {
    if (kb === null) return EMPTY_KB
    await kb.reindex()
    return kb.status()
  })
  registerHandler('kb:search', isTrustedSender, async ({ query }) => (kb === null || query.trim() === '' ? [] : kb.search(query, 6)))
}
