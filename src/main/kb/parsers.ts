import { readFile } from 'node:fs/promises'
import { extname } from 'node:path'
import { chunkCsv, chunkDocument, chunkQaList, type Chunk } from './chunk'

export const SUPPORTED_EXTENSIONS = ['.md', '.markdown', '.txt', '.docx', '.pdf', '.json', '.csv'] as const

export function isSupported(file: string): boolean {
  return (SUPPORTED_EXTENSIONS as readonly string[]).includes(extname(file).toLowerCase())
}

/** Reads one notes file and returns its chunks. Throws with a readable message on unsupported or broken files. */
export async function parseFile(file: string): Promise<Chunk[]> {
  const extension = extname(file).toLowerCase()
  switch (extension) {
    case '.md':
    case '.markdown':
    case '.txt':
      return chunkDocument(await readFile(file, 'utf8'))
    case '.docx': {
      const mammoth = await import('mammoth')
      const result = await mammoth.extractRawText({ path: file })
      return chunkDocument(result.value)
    }
    case '.pdf': {
      const { extractText, getDocumentProxy } = await import('unpdf')
      const pdf = await getDocumentProxy(new Uint8Array(await readFile(file)))
      const { text } = await extractText(pdf, { mergePages: true })
      return chunkDocument(text)
    }
    case '.json': {
      const data: unknown = JSON.parse(await readFile(file, 'utf8'))
      const list = Array.isArray(data)
        ? data
        : typeof data === 'object' && data !== null && Array.isArray((data as Record<string, unknown>)['questions'])
          ? ((data as Record<string, unknown>)['questions'] as unknown[])
          : null
      if (list === null) throw new Error('JSON notes must be a list of {"question", "answer"} items.')
      return chunkQaList(list)
    }
    case '.csv':
      return chunkCsv(await readFile(file, 'utf8'))
    default:
      throw new Error(`Unsupported file type ${extension}. Use ${SUPPORTED_EXTENSIONS.join(', ')}.`)
  }
}
