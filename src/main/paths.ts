import { copyFileSync, existsSync, mkdirSync, readdirSync, rmdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, parse, resolve, sep } from 'node:path'
import { app } from 'electron'

/**
 * Where Glimpse keeps its data. When the app lives on a drive other than the Windows
 * drive (e.g. installed to D:\Projects\Glimpse), everything stays on that drive:
 *   installed: D:\Projects\Glimpse Data (profile, database, caches) and D:\Projects\Glimpse Notes
 *   from source: <repo>\.glimpse-data and <repo>\notes
 * Not inside the install folder itself: the uninstaller and every update delete it.
 * On the Windows drive the usual places are used (%APPDATA%\Glimpse, Documents\Glimpse Notes).
 */
export interface DataPaths {
  /** Root for the profile and scratch files, or null to use Windows' defaults. */
  readonly root: string | null
  readonly defaultNotes: string
  readonly scratch: string
}

function installBase(): string {
  return app.isPackaged ? dirname(dirname(app.getPath('exe'))) : app.getAppPath()
}

function onSystemDrive(path: string): boolean {
  const system = `${(process.env.SystemDrive ?? 'C:').toUpperCase()}${sep}`
  return parse(resolve(path)).root.toUpperCase() === system
}

let cached: DataPaths | null = null

export function dataPaths(): DataPaths {
  if (cached !== null) return cached
  const base = installBase()
  const root = onSystemDrive(base) ? null : app.isPackaged ? join(base, 'Glimpse Data') : join(base, '.glimpse-data')
  const defaultNotes = !app.isPackaged
    ? join(app.getAppPath(), 'notes')
    : root !== null
      ? join(base, 'Glimpse Notes')
      : join(app.getPath('documents'), 'Glimpse Notes')
  cached = { root, defaultNotes, scratch: root !== null ? join(root, 'scratch') : tmpdir() }
  return cached
}

/** The folder the app is installed in (packaged only): notes must not live there. */
export function installFolder(): string | null {
  return app.isPackaged ? dirname(app.getPath('exe')) : null
}

/**
 * Points Electron's profile at the data root (before the app is ready). The first time,
 * the settings database and the profile key file are copied over from the old %APPDATA%
 * profile (the key is DPAPI-protected for this Windows account, so it stays valid).
 */
export function useDataRoot(): void {
  const { root } = dataPaths()
  if (root === null) return
  // Computed rather than read from getPath('userData'), which creates the folder on C:.
  const previous = join(app.getPath('appData'), app.getName())
  const profile = join(root, 'profile')
  mkdirSync(profile, { recursive: true })
  if (!existsSync(join(profile, 'glimpse.db')) && existsSync(join(previous, 'glimpse.db'))) {
    // "Local State" holds the profile key that safeStorage uses; without it the saved API keys cannot be decrypted.
    for (const file of ['glimpse.db', 'glimpse.db-wal', 'glimpse.db-shm', 'Local State']) {
      if (existsSync(join(previous, file))) copyFileSync(join(previous, file), join(profile, file))
    }
  }
  app.setPath('userData', profile)
  // Electron may already have created the default (empty) profile folder; remove it if nothing is in it.
  try {
    if (existsSync(previous) && readdirSync(previous).length === 0) rmdirSync(previous)
  } catch {
    // Not important: an empty folder.
  }
}
