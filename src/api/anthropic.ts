// Adaptador Anthropic /v1/messages: converte o histórico OpenAI-compat pro
// formato da Anthropic, manda em streaming e parseia o SSE de eventos próprios.
// Devolve o mesmo StreamResult do client OpenAI pra UI não saber a diferença.

import type { ChatMessage, ToolCall, ToolDef, Usage } from './types.js'
import type { Provider } from '../providers.js'
import type { Credential } from '../auth.js'

const ANTHROPIC_VERSION = '2023-06-01'

export type AnthropicCallbacks = {
  onText?: (delta: string) => void
  onReasoning?: (delta: string) => void
}

export type AnthropicResult = {
  content: string
  reasoning: string
  toolCalls: ToolCall[]
  usage: Usage
  finishReason: string | null
}

type Block =
  | { type: 'text'; text: string }
  | { type: 'image'; source: { type: 'base64'; media_type: string; data: string } }
  | { type: 'tool_use'; id: string; name: string; input: unknown }
  | { type: 'tool_result'; tool_use_id: string; content: string }
type AnthMsg = { role: 'user' | 'assistant'; content: Block[] }

// OpenAI ChatMessage[] → { system, messages } da Anthropic.
// system vira string no topo; tool_calls/tool viram content blocks; mensagens
// consecutivas de mesmo papel-resultante são fundidas (Anthropic alterna papéis).
// Anthropic exige tool_use.id no padrão ^[a-zA-Z0-9_-]+$. IDs gerados por
// outros providers (ex: com '.') dão HTTP 400 — sanitiza determinístico pros
// dois lados (tool_use e tool_result) continuarem casando.
const sanitizeId = (id: string): string => id.replace(/[^a-zA-Z0-9_-]/g, '_') || 'tool_0'

const convert = (messages: ChatMessage[]): { system: string; msgs: AnthMsg[] } => {
  const systemParts: string[] = []
  const msgs: AnthMsg[] = []
  const push = (role: 'user' | 'assistant', blocks: Block[]): void => {
    const last = msgs[msgs.length - 1]
    if (last && last.role === role) last.content.push(...blocks)
    else msgs.push({ role, content: blocks })
  }
  for (const m of messages) {
    if (m.role === 'system') {
      systemParts.push(m.content)
    } else if (m.role === 'user') {
      const blocks: Block[] = []
      if (m.content) blocks.push({ type: 'text', text: m.content })
      for (const img of m.images ?? []) {
        const b64 = img.dataUrl.includes(',') ? img.dataUrl.slice(img.dataUrl.indexOf(',') + 1) : img.dataUrl
        blocks.push({ type: 'image', source: { type: 'base64', media_type: img.mediaType, data: b64 } })
      }
      if (blocks.length) push('user', blocks)
    } else if (m.role === 'assistant') {
      const blocks: Block[] = []
      if (m.content) blocks.push({ type: 'text', text: m.content })
      for (const tc of m.tool_calls ?? []) {
        let input: unknown = {}
        try {
          input = JSON.parse(tc.function.arguments || '{}')
        } catch {
          input = {}
        }
        blocks.push({ type: 'tool_use', id: sanitizeId(tc.id), name: tc.function.name, input })
      }
      if (blocks.length) push('assistant', blocks)
    } else {
      // role 'tool' → tool_result dentro de uma mensagem user
      push('user', [{ type: 'tool_result', tool_use_id: sanitizeId(m.tool_call_id), content: m.content }])
    }
  }
  return { system: systemParts.join('\n\n'), msgs }
}

const convertTools = (tools?: ToolDef[]): unknown[] | undefined =>
  tools?.map(t => ({
    name: t.function.name,
    description: t.function.description,
    input_schema: t.function.parameters,
  }))

export const streamAnthropic = async (
  provider: Provider,
  cred: Credential,
  model: string,
  messages: ChatMessage[],
  opts: {
    tools?: ToolDef[]
    temperature?: number
    maxTokens?: number
    signal?: AbortSignal
    callbacks?: AnthropicCallbacks
  } = {},
): Promise<AnthropicResult> => {
  const { tools, temperature = 0.5, maxTokens = 8192, signal, callbacks } = opts
  const { system, msgs } = convert(messages)

  // Opus 4.7/4.8 e Fable 5 removeram os parâmetros de sampling: mandar
  // temperature dá HTTP 400. Sonnet 4.6/Haiku ainda aceitam.
  const noSampling = /claude-(opus-4-[78]|fable-5)/.test(model)
  const body: Record<string, unknown> = {
    model,
    max_tokens: maxTokens,
    stream: true,
    messages: msgs,
  }
  if (!noSampling) body.temperature = temperature
  // OAuth (Claude Pro/Max) exige que o 1º bloco de system seja a identidade do
  // Claude Code, senão a inferência dá 401. Com api-key manda o system normal.
  if (cred.type === 'oauth') {
    const spoof = { type: 'text', text: "You are Claude Code, Anthropic's official CLI for Claude." }
    body.system = system ? [spoof, { type: 'text', text: system }] : [spoof]
  } else if (system) {
    body.system = system
  }
  const anthTools = convertTools(tools)
  if (anthTools && anthTools.length) body.tools = anthTools

  // auth: api-key no header x-api-key; oauth (Claude Pro/Max) via Bearer + beta
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'anthropic-version': ANTHROPIC_VERSION,
  }
  if (cred.type === 'api') headers['x-api-key'] = cred.key
  else {
    headers.Authorization = `Bearer ${cred.access}`
    headers['anthropic-beta'] = 'oauth-2025-04-20'
  }

  const res = await fetch(provider.url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    signal,
  })
  if (!res.ok || !res.body) {
    const text = await res.text().catch(() => '')
    throw new Error(`HTTP ${res.status} — ${text.slice(0, 300)}`)
  }

  const result: AnthropicResult = {
    content: '',
    reasoning: '',
    toolCalls: [],
    usage: { in: 0, out: 0 },
    finishReason: null,
  }
  // tool_use acumulado por índice de content block
  const toolAcc = new Map<number, { id: string; name: string; args: string }>()

  const handleEvent = (data: string): void => {
    let obj: any
    try {
      obj = JSON.parse(data)
    } catch {
      return
    }
    switch (obj.type) {
      case 'message_start':
        result.usage.in = obj.message?.usage?.input_tokens ?? 0
        break
      case 'content_block_start':
        if (obj.content_block?.type === 'tool_use') {
          toolAcc.set(obj.index, { id: obj.content_block.id, name: obj.content_block.name, args: '' })
        }
        break
      case 'content_block_delta': {
        const d = obj.delta ?? {}
        if (d.type === 'text_delta' && d.text) {
          result.content += d.text
          callbacks?.onText?.(d.text)
        } else if (d.type === 'thinking_delta' && d.thinking) {
          result.reasoning += d.thinking
          callbacks?.onReasoning?.(d.thinking)
        } else if (d.type === 'input_json_delta' && typeof d.partial_json === 'string') {
          const cur = toolAcc.get(obj.index)
          if (cur) cur.args += d.partial_json
        }
        break
      }
      case 'message_delta':
        if (obj.delta?.stop_reason) result.finishReason = obj.delta.stop_reason
        if (obj.usage?.output_tokens) result.usage.out = obj.usage.output_tokens
        break
      default:
        break
    }
  }

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''
    for (const line of lines) {
      const t = line.trim()
      if (t.startsWith('data:')) handleEvent(t.slice(5).trim())
    }
  }

  result.toolCalls = [...toolAcc.entries()]
    .sort(([a], [b]) => a - b)
    .map(([, v]) => ({
      id: v.id,
      type: 'function' as const,
      function: { name: v.name, arguments: v.args || '{}' },
    }))
  return result
}
