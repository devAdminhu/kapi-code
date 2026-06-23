import type { ChatMessage, ToolCall, ToolDef, Usage } from './types.js'
import { providerIdOf } from '../models.js'
import { providerOf } from '../providers.js'
import { getCredential } from '../auth.js'
import { streamAnthropic } from './anthropic.js'

// status que valem retry com backoff (rate limit / instabilidade transitória)
const RETRYABLE = new Set([429, 500, 502, 503, 529])
const MAX_RETRIES = 2

// inatividade máxima do stream: sem nenhum byte nesse intervalo, aborta com
// erro claro em vez de pendurar pra sempre numa conexão morta
const STALL_MS = 120_000

export type StreamCallbacks = {
  onText?: (delta: string) => void
  onReasoning?: (delta: string) => void
}

export type StreamResult = {
  content: string
  reasoning: string
  toolCalls: ToolCall[]
  usage: Usage
  finishReason: string | null
}

type RawToolCall = {
  index: number
  id?: string
  type?: string
  function?: { name?: string; arguments?: string }
}

/**
 * Faz a chamada em streaming e devolve o resultado completo (texto + reasoning +
 * tool_calls montados). Emite deltas via callbacks pra UI animar token a token.
 */
export const streamChat = async (
  model: string,
  messages: ChatMessage[],
  opts: {
    tools?: ToolDef[]
    temperature?: number
    maxTokens?: number
    signal?: AbortSignal
    callbacks?: StreamCallbacks
  } = {},
): Promise<StreamResult> => {
  const { tools, temperature = 0.5, maxTokens = 8192, signal, callbacks } = opts

  // mensagens com imagem viram content multimodal (OpenAI-compat): texto +
  // image_url base64. As demais passam intactas.
  const wireMessages = messages.map(m =>
    m.role === 'user' && m.images?.length
      ? {
          role: 'user' as const,
          content: [
            ...(m.content ? [{ type: 'text', text: m.content }] : []),
            ...m.images.map(img => ({ type: 'image_url', image_url: { url: img.dataUrl } })),
          ],
        }
      : m,
  )

  const body: Record<string, unknown> = {
    model,
    messages: wireMessages,
    max_tokens: maxTokens,
    temperature,
    stream: true,
    stream_options: { include_usage: true },
  }
  if (tools && tools.length) {
    body.tools = tools
    body.tool_choice = 'auto'
  }

  // roteamento por provider: resolve endpoint + credencial do modelo atual
  const provider = providerOf(providerIdOf(model))
  const cred = getCredential(provider.id)
  if (!cred) {
    throw new Error(`${provider.name} não conectado. Use /login pra colar a API key.`)
  }
  // Anthropic usa /v1/messages (formato próprio) — delega pro adaptador
  if (provider.format === 'anthropic') {
    return streamAnthropic(provider, cred, model, messages, { tools, temperature, maxTokens, signal, callbacks })
  }
  const authValue = cred.type === 'api' ? cred.key : cred.access
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (provider.authHeader === 'x-api-key') headers['x-api-key'] = authValue
  else headers.Authorization = `Bearer ${authValue}`

  // signal interno = signal externo (cancelamento do usuário) + watchdog de stall
  const inner = new AbortController()
  const onOuterAbort = (): void => inner.abort()
  signal?.addEventListener('abort', onOuterAbort, { once: true })
  if (signal?.aborted) inner.abort()
  let stallTimer: ReturnType<typeof setTimeout> | undefined
  const armStall = (): void => {
    clearTimeout(stallTimer)
    stallTimer = setTimeout(
      () => inner.abort(new Error(`stream sem dados há ${STALL_MS / 1000}s — conexão pendurada`)),
      STALL_MS,
    )
  }

  try {
    armStall()
    const payload = JSON.stringify(body)
    let res: Response | undefined
    for (let attempt = 0; ; attempt++) {
      res = await fetch(provider.url, {
        method: 'POST',
        headers,
        body: payload,
        signal: inner.signal,
      })
      if (res.ok || attempt >= MAX_RETRIES || !RETRYABLE.has(res.status)) break
      // backoff: respeita Retry-After se vier; senão exponencial simples
      const retryAfter = Number(res.headers.get('retry-after'))
      const waitMs = retryAfter > 0 ? retryAfter * 1000 : 1500 * 2 ** attempt
      await new Promise(r => setTimeout(r, waitMs))
      if (inner.signal.aborted) break
    }

    if (!res.ok || !res.body) {
      const text = await res.text().catch(() => '')
      throw new Error(`HTTP ${res.status} — ${text.slice(0, 300)}`)
    }

    const result: StreamResult = {
      content: '',
      reasoning: '',
      toolCalls: [],
      usage: { in: 0, out: 0 },
      finishReason: null,
    }
    const toolAcc = new Map<number, { id: string; name: string; args: string }>()

    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''

    const handleData = (data: string): boolean => {
      if (data === '[DONE]') return true
      let obj: any
      try {
        obj = JSON.parse(data)
      } catch {
        return false
      }
      if (obj.usage) {
        result.usage.in = obj.usage.prompt_tokens ?? 0
        result.usage.out = obj.usage.completion_tokens ?? 0
      }
      const choice = obj.choices?.[0]
      if (!choice) return false
      if (choice.finish_reason) result.finishReason = choice.finish_reason
      const delta = choice.delta ?? {}

      if (typeof delta.reasoning_content === 'string' && delta.reasoning_content) {
        result.reasoning += delta.reasoning_content
        callbacks?.onReasoning?.(delta.reasoning_content)
      }
      if (typeof delta.content === 'string' && delta.content) {
        result.content += delta.content
        callbacks?.onText?.(delta.content)
      }
      for (const tc of (delta.tool_calls ?? []) as RawToolCall[]) {
        const cur = toolAcc.get(tc.index) ?? { id: '', name: '', args: '' }
        if (tc.id) cur.id = tc.id
        if (tc.function?.name) cur.name = tc.function.name
        if (tc.function?.arguments) cur.args += tc.function.arguments
        toolAcc.set(tc.index, cur)
      }
      return false
    }

    let finished = false
    while (!finished) {
      const { done, value } = await reader.read()
      if (done) break
      armStall() // chegou byte: stream vivo, rearma o watchdog
      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''
      for (const line of lines) {
        const t = line.trim()
        if (!t.startsWith('data:')) continue
        if (handleData(t.slice(5).trim())) {
          finished = true
          break
        }
      }
    }
    if (finished) void reader.cancel().catch(() => {})

    result.toolCalls = [...toolAcc.entries()]
      .sort(([a], [b]) => a - b)
      .map(([, v]) => ({
        id: v.id,
        type: 'function' as const,
        function: { name: v.name, arguments: v.args || '{}' },
      }))
      .filter(c => c.function.name)

    return result
  } finally {
    clearTimeout(stallTimer)
    signal?.removeEventListener('abort', onOuterAbort)
  }
}
