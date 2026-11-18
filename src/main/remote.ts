import { execFile } from 'node:child_process'
import type { RemoteInfo } from '../shared/capture'

/** Software that streams or shares this PC's screen by capturing it, as a recorder would. */
const VIEWER_PROCESSES: Readonly<Record<string, string>> = {
  'parsecd.exe': 'Parsec',
  'sunshine.exe': 'Sunshine (Moonlight host)',
  'anydesk.exe': 'AnyDesk',
  'teamviewer.exe': 'TeamViewer',
  'rustdesk.exe': 'RustDesk',
  'remoting_host.exe': 'Chrome Remote Desktop',
  'winvnc.exe': 'VNC',
  'tvnserver.exe': 'VNC',
  'splashtopstreamer.exe': 'Splashtop'
}

/** Extracts image names from `tasklist /FO CSV /NH` output. */
export function parseTasklist(csv: string): string[] {
  return csv
    .split(/\r?\n/)
    .map((line) => /^"([^"]+)"/.exec(line)?.[1]?.toLowerCase())
    .filter((name): name is string => name !== undefined)
}

export function matchViewers(imageNames: readonly string[]): string[] {
  const found = new Set<string>()
  for (const name of imageNames) {
    const label = VIEWER_PROCESSES[name]
    if (label !== undefined) found.add(label)
  }
  return [...found].sort()
}

function runningProcesses(): Promise<string[]> {
  return new Promise((resolve) => {
    execFile('tasklist', ['/FO', 'CSV', '/NH'], { windowsHide: true, timeout: 8000 }, (error, stdout) => {
      resolve(error === null ? parseTasklist(stdout) : [])
    })
  })
}

/** SM_REMOTESESSION is non-zero when this process runs inside a Remote Desktop session. */
async function inRdpSession(): Promise<boolean> {
  if (process.platform !== 'win32') return false
  try {
    const koffi = (await import('koffi')).default
    const getSystemMetrics = koffi.load('user32.dll').func('int __stdcall GetSystemMetrics(int index)')
    const value: unknown = getSystemMetrics(0x1000)
    return typeof value === 'number' && value !== 0
  } catch {
    return false
  }
}

/**
 * Detects remote-viewing software. These capture the screen like a recorder, so
 * through them the protected overlay is invisible to the person looking.
 * A running process does not prove a session is active: this is a hint.
 */
export async function detectRemoteViewers(): Promise<RemoteInfo> {
  const [processes, rdpSession] = await Promise.all([runningProcesses(), inRdpSession()])
  return { rdpSession, tools: matchViewers(processes) }
}
