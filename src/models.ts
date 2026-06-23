// Catálogo de modelos multi-provider. deployment = campo "model" mandado na API.
// provider liga o modelo ao endpoint/auth certo (ver providers.ts).

import type { ProviderId } from './providers.js'

export type ModelInfo = {
  alias: string
  deployment: string
  provider: ProviderId
  inPrice: number // $/1M tokens entrada
  outPrice: number // $/1M tokens saída
  ctxLimit: number // janela de contexto (tokens)
  note: string
}

export const MODELS: ModelInfo[] = [
  // Azure (crédito Free Trial do João)
  { alias: 'deepseek', deployment: 'DeepSeek-V4-Flash', provider: 'azure', inPrice: 0.27, outPrice: 1.1, ctxLimit: 128_000, note: 'rápido, default chat' },
  { alias: 'kimi', deployment: 'Kimi-K2.6', provider: 'azure', inPrice: 0.66, outPrice: 3.3, ctxLimit: 256_000, note: 'contexto gigante' },
  { alias: 'llama', deployment: 'Llama-4-Maverick', provider: 'azure', inPrice: 0.35, outPrice: 1.41, ctxLimit: 1_000_000, note: 'equilibrado' },
  { alias: 'mistral', deployment: 'Mistral-Large-3', provider: 'azure', inPrice: 2.0, outPrice: 6.0, ctxLimit: 128_000, note: 'robusto' },
  { alias: 'oss', deployment: 'gpt-oss-120b', provider: 'azure', inPrice: 0.15, outPrice: 0.6, ctxLimit: 128_000, note: 'mais barato' },
  { alias: 'grok', deployment: 'grok-4-20-reasoning', provider: 'azure', inPrice: 3.0, outPrice: 15.0, ctxLimit: 256_000, note: 'melhor raciocínio, default agente' },
  { alias: 'o4', deployment: 'o4-mini', provider: 'azure', inPrice: 1.21, outPrice: 2.2, ctxLimit: 200_000, note: 'reasoning OpenAI' },
  // z.ai (GLM) — key do João
  { alias: 'glm', deployment: 'glm-5.2', provider: 'zai', inPrice: 0.6, outPrice: 2.2, ctxLimit: 200_000, note: 'GLM-5.2, coding' },
  { alias: 'glm-air', deployment: 'glm-4.7', provider: 'zai', inPrice: 0.2, outPrice: 1.1, ctxLimit: 200_000, note: 'GLM mais leve' },
  // Anthropic (key ou OAuth Claude Pro/Max)
  { alias: 'opus', deployment: 'claude-opus-4-8', provider: 'anthropic', inPrice: 5.0, outPrice: 25.0, ctxLimit: 1_000_000, note: 'Claude Opus 4.8' },
  { alias: 'opus47', deployment: 'claude-opus-4-7', provider: 'anthropic', inPrice: 5.0, outPrice: 25.0, ctxLimit: 1_000_000, note: 'Claude Opus 4.7' },
  { alias: 'opus45', deployment: 'claude-opus-4-5', provider: 'anthropic', inPrice: 5.0, outPrice: 25.0, ctxLimit: 1_000_000, note: 'Claude Opus 4.5' },
  { alias: 'sonnet', deployment: 'claude-sonnet-4-6', provider: 'anthropic', inPrice: 3.0, outPrice: 15.0, ctxLimit: 1_000_000, note: 'Claude Sonnet 4.6' },
  { alias: 'haiku', deployment: 'claude-haiku-4-5', provider: 'anthropic', inPrice: 1.0, outPrice: 5.0, ctxLimit: 200_000, note: 'Claude Haiku 4.5, rápido' },
  // OpenAI
  { alias: 'gpt', deployment: 'gpt-5.4', provider: 'openai', inPrice: 2.5, outPrice: 15.0, ctxLimit: 1_050_000, note: 'GPT-5.4' },
  { alias: 'gpt-mini', deployment: 'gpt-5.2', provider: 'openai', inPrice: 1.75, outPrice: 14.0, ctxLimit: 400_000, note: 'GPT-5.2' },
  // Google Gemini (key ou OAuth)
  { alias: 'gemini', deployment: 'gemini-3-flash-preview', provider: 'google', inPrice: 0.5, outPrice: 3.0, ctxLimit: 1_000_000, note: 'Gemini 3.0 Flash' },
  { alias: 'gemini-pro', deployment: 'gemini-2.5-pro', provider: 'google', inPrice: 1.25, outPrice: 10.0, ctxLimit: 1_050_000, note: 'Gemini 2.5 Pro' },
  // Groq (rápido)
  { alias: 'groq', deployment: 'moonshotai/kimi-k2-instruct', provider: 'groq', inPrice: 1.0, outPrice: 3.0, ctxLimit: 256_000, note: 'Groq, baixa latência' },
  // OpenRouter (agrega tudo) — exemplo de entrada
  { alias: 'or-claude', deployment: 'anthropic/claude-sonnet-4.6', provider: 'openrouter', inPrice: 3.0, outPrice: 15.0, ctxLimit: 1_000_000, note: 'Claude via OpenRouter' },
]

export const DEFAULT_ALIAS = 'grok' // melhor pra agente

const byAlias = new Map(MODELS.map(m => [m.alias, m]))
const byDeployment = new Map(MODELS.map(m => [m.deployment, m]))

export const aliasOf = (deployment: string): string =>
  byDeployment.get(deployment)?.alias ?? deployment

export const infoOf = (deployment: string): ModelInfo | undefined =>
  byDeployment.get(deployment)

// provider do modelo (default azure pra deployment desconhecido, retrocompat)
export const providerIdOf = (deployment: string): ProviderId =>
  byDeployment.get(deployment)?.provider ?? 'azure'

export const ctxLimitOf = (deployment: string): number =>
  byDeployment.get(deployment)?.ctxLimit ?? 128_000

/**
 * Estimativa de tokens por tipo de conteúdo, no estilo do Claude Code: JSON/código
 * denso (muitos `{}:,"`) gira ~2 bytes/token; prosa ~4. Detecta heurísticamente.
 */
export const estimateTokens = (text: string): number => {
  if (!text) return 0
  // densidade de pontuação estrutural sugere JSON/código
  const structural = (text.match(/[{}[\]:,"]/g) ?? []).length
  const ratio = structural / text.length > 0.08 ? 2.5 : 4
  return Math.ceil(text.length / ratio)
}

/** Resolve um nome solto (alias, deployment ou substring) pro deployment. */
export const resolveModel = (name: string): string | null => {
  const exact = byAlias.get(name)
  if (exact) return exact.deployment
  if (byDeployment.has(name)) return name
  const q = name.toLowerCase()
  const fuzzy = MODELS.find(m => m.alias.toLowerCase().includes(q) || m.deployment.toLowerCase().includes(q))
  return fuzzy?.deployment ?? null
}

export const costOf = (deployment: string, inTok: number, outTok: number): number => {
  const m = byDeployment.get(deployment)
  if (!m) return 0
  return (inTok / 1e6) * m.inPrice + (outTok / 1e6) * m.outPrice
}
