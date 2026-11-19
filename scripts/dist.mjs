// Builds the Windows installer with Electron's download caches kept in the repo's .cache folder,
// so building does not fill the Windows drive.
import { spawnSync } from 'node:child_process'
import { join, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const env = {
  ...process.env,
  ELECTRON_CACHE: join(root, '.cache', 'electron'),
  ELECTRON_BUILDER_CACHE: join(root, '.cache', 'electron-builder')
}
for (const command of ['npm run build', 'npx electron-builder --win nsis --x64']) {
  const result = spawnSync(command, { cwd: root, env, stdio: 'inherit', shell: true })
  if (result.status !== 0) process.exit(result.status ?? 1)
}
