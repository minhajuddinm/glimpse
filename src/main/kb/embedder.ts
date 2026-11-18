import { existsSync } from 'node:fs'
import { join } from 'node:path'

export interface Embedder {
  embed(texts: readonly string[]): Promise<Float32Array[]>
}

export const EMBEDDING_MODEL = 'Xenova/bge-small-en-v1.5'

/**
 * Loads the local sentence-embedding model (downloaded and hash-checked by
 * `npm run fetch-models -- --only bge-small-en`). Never fetches anything at runtime.
 * Returns null if the model is not installed: search then falls back to keywords.
 */
export async function loadEmbedder(modelsRoot: string): Promise<Embedder | null> {
  const root = join(modelsRoot, 'embeddings')
  if (!existsSync(join(root, EMBEDDING_MODEL, 'onnx', 'model_quantized.onnx'))) return null
  const transformers = await import('@huggingface/transformers')
  transformers.env.localModelPath = root
  transformers.env.allowLocalModels = true
  transformers.env.allowRemoteModels = false
  const extractor = await transformers.pipeline('feature-extraction', EMBEDDING_MODEL, { dtype: 'q8' })
  return {
    async embed(texts) {
      if (texts.length === 0) return []
      const output = await extractor([...texts], { pooling: 'mean', normalize: true })
      const width = output.dims.at(-1) ?? 0
      const data = output.data as Float32Array
      return texts.map((_, row) => data.slice(row * width, (row + 1) * width))
    }
  }
}
