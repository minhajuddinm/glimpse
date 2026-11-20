import { mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { BrowserWindow, app, dialog, shell } from 'electron'
import type { MeetingFiles, MeetingManager } from './meetings/manager'
import { exportMarkdown, minutesFileName } from './meetings/minutes'
import type { MeetingStore } from './meetings/store'
import { registerHandler } from './ipc'
import { isTrustedSender } from './security'
import type { SettingsStore } from './settingsStore'

/** Minutes go to "<notes folder>/Meetings", so later answers can draw on past meetings. */
export function notesMeetingFiles(settings: SettingsStore, notesFolder: () => string): MeetingFiles {
  return {
    async write(fileName, contents) {
      if (!settings.get().saveMinutesToNotes) return null
      const folder = join(notesFolder(), 'Meetings')
      await mkdir(folder, { recursive: true })
      const path = join(folder, fileName)
      await writeFile(path, contents, 'utf8')
      return path
    },
    async remove(path) {
      await rm(path, { force: true })
    }
  }
}

/** `onActiveChanged` re-applies capture (listen-only-during-meetings turns it on and off). */
export function registerMeetingHandlers(meetings: MeetingManager, store: MeetingStore, onActiveChanged: () => void): void {
  registerHandler('meetings:state', isTrustedSender, () => meetings.state())
  registerHandler('meetings:start', isTrustedSender, ({ title }) => {
    const state = meetings.start(title)
    onActiveChanged()
    return state
  })
  registerHandler('meetings:stop', isTrustedSender, () => {
    const state = meetings.stop()
    onActiveChanged()
    return state
  })
  registerHandler('meetings:list', isTrustedSender, () => store.list())
  registerHandler('meetings:get', isTrustedSender, ({ id }) => store.detail(id))
  registerHandler('meetings:summarize', isTrustedSender, ({ id }) => {
    void meetings.summarize(id)
    return null
  })
  registerHandler('meetings:rename', isTrustedSender, ({ id, title }) => {
    meetings.rename(id, title)
    return null
  })
  registerHandler('meetings:delete', isTrustedSender, async ({ id }) => {
    await meetings.delete(id)
    return null
  })
  registerHandler('meetings:export', isTrustedSender, async ({ id }, event) => {
    const detail = store.detail(id)
    if (detail === null) throw new Error('That meeting no longer exists.')
    const owner = BrowserWindow.fromWebContents(event.sender)
    const options = {
      title: 'Export meeting',
      defaultPath: join(app.getPath('documents'), minutesFileName(detail.title, detail.startedAt)),
      filters: [{ name: 'Markdown', extensions: ['md'] }]
    }
    const result = owner === null ? await dialog.showSaveDialog(options) : await dialog.showSaveDialog(owner, options)
    if (result.canceled || result.filePath === '') return null
    await writeFile(result.filePath, exportMarkdown(detail.title, detail.startedAt, detail.endedAt, detail.minutes, detail.transcript), 'utf8')
    return result.filePath
  })
  registerHandler('meetings:open-file', isTrustedSender, ({ id }) => {
    const file = store.detail(id)?.file
    if (file === null || file === undefined) throw new Error('These minutes were not saved to the notes folder.')
    shell.showItemInFolder(file)
    return null
  })
}
