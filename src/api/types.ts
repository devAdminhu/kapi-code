// Tipos OpenAI-compatible (subconjunto que o Kapi usa).

export type ToolCall = {
  id: string
  type: 'function'
  function: { name: string; arguments: string }
}

// imagem anexada a uma mensagem do usuário (paste do clipboard).
// dataUrl no formato data:image/png;base64,XXXX — serve pros dois wires.
export type ImagePart = { dataUrl: string; mediaType: string }

export type ChatMessage =
  | { role: 'system'; content: string }
  | { role: 'user'; content: string; images?: ImagePart[] }
  | { role: 'assistant'; content: string | null; tool_calls?: ToolCall[] }
  | { role: 'tool'; tool_call_id: string; content: string }

export type ToolDef = {
  type: 'function'
  function: {
    name: string
    description: string
    parameters: {
      type: 'object'
      properties: Record<string, { type: string; description?: string }>
      required: string[]
    }
  }
}

export type Usage = { in: number; out: number }

// chunk de streaming já parseado
export type StreamDelta = {
  content?: string
  reasoning?: string
  toolCalls?: Array<{ index: number; id?: string; name?: string; arguments?: string }>
}
