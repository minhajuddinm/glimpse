import Anthropic from '@anthropic-ai/sdk'

export interface LlmCall {
  readonly system: string
  readonly user: string
  readonly maxTokens: number
  /** Fuller, slower model for "elaborate". */
  readonly deep: boolean
  /** JPEG screenshot, base64, for the screen-share question. */
  readonly imageJpeg?: string
}

export interface LlmProvider {
  readonly id: 'anthropic' | 'groq'
  model(deep: boolean): string
  /** Streams text deltas; resolves with the full text. Rejects with an AbortError when the signal fires. */
  stream(call: LlmCall, onText: (delta: string) => void, signal: AbortSignal): Promise<string>
}

export const ANTHROPIC_FAST_MODEL = 'claude-haiku-5-5'
export const ANTHROPIC_DEEP_MODEL = 'claude-sonnet-5-5'
export const GROQ_MODEL = 'openai/gpt-oss-120b'

/**
 * Claude: Haiku 5.5 for live answers (thinking off for the lowest time to first token;
 * system prompt cached), Sonnet 5.5 for "elaborate".
 */
export function anthropicProvider(apiKey: string): LlmProvider {
  const client = new Anthropic({ apiKey, maxRetries: 1, timeout: 30_000 })
  return {
    id: 'anthropic',
    model: (deep) => (deep ? ANTHROPIC_DEEP_MODEL : ANTHROPIC_FAST_MODEL),
    async stream(call, onText, signal) {
      const content: Anthropic.ContentBlockParam[] = []
      if (call.imageJpeg !== undefined) {
        content.push({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: call.imageJpeg } })
      }
      content.push({ type: 'text', text: call.user })
      const system: Anthropic.TextBlockParam[] = [{ type: 'text', text: call.system, cache_control: { type: 'ephemeral' } }]
      const stream = call.deep
        ? client.beta.messages.stream(
            {
              model: ANTHROPIC_DEEP_MODEL,
              max_tokens: call.maxTokens,
              system,
              output_config: { effort: 'low' },
              // If Sonnet declines on a safety classifier, the API retries on a fallback model it picks.
              betas: ['server-side-fallback-2026-07-01'],
              fallbacks: 'default',
              messages: [{ role: 'user', content }]
            },
            { signal }
          )
        : client.messages.stream(
            { model: ANTHROPIC_FAST_MODEL, max_tokens: call.maxTokens, system, thinking: { type: 'disabled' }, messages: [{ role: 'user', content }] },
            { signal }
          )
      let text = ''
      for await (const event of stream) {
        if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
          text += event.delta.text
          onText(event.delta.text)
        }
      }
      const message = await stream.finalMessage()
      if (message.stop_reason === 'refusal') throw new Error('The model declined to answer this one.')
      return text
    }
  }
}

/** Groq's free tier (OpenAI-compatible streaming API): the zero-cost fallback. Text only. */
export function groqProvider(apiKey: string, fetchImpl: typeof fetch = fetch): LlmProvider {
  return {
    id: 'groq',
    model: () => GROQ_MODEL,
    async stream(call, onText, signal) {
      const response = await fetchImpl('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        signal,
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: GROQ_MODEL,
          stream: true,
          max_completion_tokens: call.maxTokens * 4,
          reasoning_effort: 'low',
          include_reasoning: false,
          messages: [
            { role: 'system', content: call.system },
            { role: 'user', content: call.user }
          ]
        })
      })
      if (!response.ok || response.body === null) {
        const detail = (await response.text().catch(() => '')).slice(0, 200)
        throw new Error(`Groq error ${response.status}${detail === '' ? '' : `: ${detail}`}`)
      }
      const reader = (response.body as ReadableStream<Uint8Array>).getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      let text = ''
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        let newline = buffer.indexOf('\n')
        while (newline >= 0) {
          const line = buffer.slice(0, newline).trim()
          buffer = buffer.slice(newline + 1)
          newline = buffer.indexOf('\n')
          if (!line.startsWith('data:')) continue
          const data = line.slice(5).trim()
          if (data === '[DONE]') return text
          const parsed: unknown = JSON.parse(data)
          const delta = (parsed as { choices?: { delta?: { content?: unknown } }[] }).choices?.[0]?.delta?.content
          if (typeof delta === 'string' && delta.length > 0) {
            text += delta
            onText(delta)
          }
        }
      }
      return text
    }
  }
}
