// Builds the installer for the current platform: an NSIS installer on Windows, a DMG for this Mac's
// architecture (Apple silicon or Intel) on macOS. Electron's download caches stay in the repo's .cache folder,
// so building does not fill the system drive.
import { spawnSync } from 'node:child_process'
import { join, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const env = {
  ...process.env,
  ELECTRON_CACHE: join(root, '.cache', 'electron'),
  ELECTRON_BUILDER_CACHE: join(root, '.cache', 'electron-builder'),
  // No Developer ID: sign ad hoc instead of looking for one in the keychain.
  CSC_IDENTITY_AUTO_DISCOVERY: 'false'
}
// Each Mac arch is built on its own machine: the native speech addon is installed per arch.
const target = `${process.platform === 'darwin' ? `--mac dmg --${process.arch}` : '--win nsis --x64'} --publish never`
for (const command of ['npm run build', `npx electron-builder ${target}`]) {
  const result = spawnSync(command, { cwd: root, env, stdio: 'inherit', shell: true })
  if (result.status !== 0) process.exit(result.status ?? 1)
}
