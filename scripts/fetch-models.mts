/**
 * Downloads speech-recognition models into ./models (git-ignored).
 *
 *   npm run fetch-models                       all models
 *   npm run fetch-models -- --only kroko-en    one or more ids, comma separated
 *   npm run fetch-models -- --list             show the registry and what is installed
 *
 * Every archive is checked against its pinned SHA-256. Where the registry has no
 * pinned hash yet (older upstream assets publish none), the computed hash is
 * printed so it can be pinned in src/main/asr/models.json.
 */
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createReadStream, createWriteStream, existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { z } from 'zod'

const ModelSchema = z.object({
  id: z.string(),
  dir: z.string(),
  url: z.url(),
  bytes: z.number().int().positive(),
  sha256: z.string().regex(/^[0-9a-f]{64}$/).nullable(),
  featureDim: z.number().int(),
  family: z.enum(['zipformer', 'nemo-transducer', 'nemotron', 'vad', 'embedding']),
  /** Set for multi-file assets: each path is fetched from `${url}/${path}` and checked against its hash. */
  files: z.array(z.object({ path: z.string(), bytes: z.number().int(), sha256: z.string().regex(/^[0-9a-f]{64}$/) })).optional(),
  /** Set for single-file assets that are not tar archives. */
  file: z.string().optional(),
  note: z.string()
})

const root = resolve(import.meta.dirname, '..')
const modelsDir = join(root, 'models')
const downloadsDir = join(modelsDir, '.downloads')
const registry = z.array(ModelSchema).parse(JSON.parse(readFileSync(join(root, 'src/main/asr/models.json'), 'utf8')))

/** Windows ships bsdtar, which handles drive-letter paths; the GNU tar that Git Bash puts first on PATH does not. */
function tarCommand(): string {
  const systemRoot = process.env['SystemRoot']
  return process.platform === 'win32' && systemRoot !== undefined ? join(systemRoot, 'System32', 'tar.exe') : 'tar'
}

function sha256Of(file: string): Promise<string> {
  return new Promise((resolveHash, reject) => {
    const hash = createHash('sha256')
    createReadStream(file)
      .on('data', (chunk) => hash.update(chunk))
      .on('end', () => {
        resolveHash(hash.digest('hex'))
      })
      .on('error', reject)
  })
}

async function download(url: string, file: string, expectedBytes: number): Promise<void> {
  const response = await fetch(url, { redirect: 'follow' })
  if (!response.ok || response.body === null) throw new Error(`Download failed: HTTP ${response.status} for ${url}`)
  const partial = `${file}.partial`
  let received = 0
  let lastPercent = -1
  const body = Readable.fromWeb(response.body)
  body.on('data', (chunk: Buffer) => {
    received += chunk.length
    const percent = Math.floor((received / expectedBytes) * 10) * 10
    if (percent !== lastPercent) {
      lastPercent = percent
      process.stdout.write(`  ${Math.min(percent, 100)}%`)
    }
  })
  await pipeline(body, createWriteStream(partial))
  process.stdout.write('\n')
  renameSync(partial, file)
}

async function install(model: z.infer<typeof ModelSchema>): Promise<void> {
  const target = join(modelsDir, model.dir)
  if (existsSync(target)) {
    console.log(`✓ ${model.id}: already installed`)
    return
  }
  if (model.files !== undefined) {
    for (const file of model.files) {
      const destination = join(target, ...file.path.split('/'))
      mkdirSync(join(destination, '..'), { recursive: true })
      console.log(`↓ ${model.id}/${file.path}: ${(file.bytes / 1048576).toFixed(1)} MB`)
      await download(`${model.url}/${file.path}`, destination, file.bytes)
      const hash = await sha256Of(destination)
      if (hash !== file.sha256) {
        rmSync(target, { recursive: true, force: true })
        throw new Error(`${model.id}/${file.path}: SHA-256 mismatch (expected ${file.sha256}, got ${hash}). Deleted.`)
      }
    }
    console.log(`✓ ${model.id}: installed`)
    return
  }
  if (model.file !== undefined) {
    mkdirSync(target, { recursive: true })
    const destination = join(target, model.file)
    console.log(`↓ ${model.id}: ${(model.bytes / 1048576).toFixed(1)} MB`)
    await download(model.url, destination, model.bytes)
    const hash = await sha256Of(destination)
    if (model.sha256 !== null && hash !== model.sha256) {
      rmSync(target, { recursive: true, force: true })
      throw new Error(`${model.id}: SHA-256 mismatch (expected ${model.sha256}, got ${hash}). Deleted.`)
    }
    console.log(`✓ ${model.id}: installed`)
    return
  }
  mkdirSync(downloadsDir, { recursive: true })
  const archive = join(downloadsDir, `${model.dir}.tar.bz2`)
  if (!existsSync(archive) || statSync(archive).size !== model.bytes) {
    console.log(`↓ ${model.id}: ${(model.bytes / 1048576).toFixed(0)} MB`)
    await download(model.url, archive, model.bytes)
  }
  const actual = await sha256Of(archive)
  if (model.sha256 === null) {
    console.log(`  no pinned hash for ${model.id}; computed sha256 ${actual}`)
  } else if (actual !== model.sha256) {
    rmSync(archive, { force: true })
    throw new Error(`${model.id}: SHA-256 mismatch (expected ${model.sha256}, got ${actual}). The archive was deleted.`)
  }
  console.log(`  extracting ${model.id}`)
  const result = spawnSync(tarCommand(), ['-xjf', archive, '-C', modelsDir], { stdio: 'inherit' })
  if (result.status !== 0) throw new Error(`tar failed with status ${String(result.status)} for ${model.id}`)
  if (!existsSync(target)) throw new Error(`${model.id}: expected folder ${model.dir} after extraction`)
  rmSync(archive, { force: true })
  console.log(`✓ ${model.id}: installed`)
}

async function main(): Promise<void> {
  const args = process.argv.slice(2)
  if (args.includes('--list')) {
    for (const model of registry) {
      const installed = existsSync(join(modelsDir, model.dir))
      console.log(`${installed ? '✓' : '·'} ${model.id.padEnd(26)} ${(model.bytes / 1048576).toFixed(0).padStart(4)} MB  ${model.note}`)
    }
    return
  }
  const onlyIndex = args.indexOf('--only')
  const only = onlyIndex >= 0 ? (args[onlyIndex + 1] ?? '').split(',').filter((id) => id.length > 0) : null
  const selected = only === null ? registry : registry.filter((model) => only.includes(model.id))
  const unknown = (only ?? []).filter((id) => !registry.some((model) => model.id === id))
  if (unknown.length > 0) throw new Error(`Unknown model id(s): ${unknown.join(', ')}. Use --list to see them.`)
  mkdirSync(modelsDir, { recursive: true })
  for (const model of selected) await install(model)
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
