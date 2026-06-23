// Descobre a janela de contexto de cada modelo via API pública e gratuita do
// OpenRouter (sem chave). Usa o cache robusto (cache.ts): envelope versionado,
// escrita atômica, stale-while-revalidate. Fallback: tabela do models.ts.
import { ctxLimitOf, MODELS } from './models.js'
import { CTX_CACHE_PATH } from './config.js'
import { swr, type CacheSpec } from './cache.js'

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/models'
const TTL_MS = 7 * 24 * 60 * 60 * 1000

// substrings pra casar nosso deployment Azure → id do OpenRouter
const MATCH: Record<string, string[]> = {
  'DeepSeek-V4-Flash': ['deepseek-chat', 'deepseek/deepseek-v3', 'deepseek-v3'],
  'Kimi-K2.6': ['moonshotai/kimi-k2', 'kimi-k2'],
  'Llama-4-Maverick': ['llama-4-maverick', 'maverick'],
  'Mistral-Large-3': ['mistral-large'],
  'gpt-oss-120b': ['gpt-oss-120b'],
  'grok-4-20-reasoning': ['grok-4'],
  'o4-mini': ['o4-mini'],
}

type Limits = Record<string, number>

const isLimits = (v: unknown): v is Limits =>
  !!v && typeof v === 'object' && Object.values(v as object).every(n => typeof n === 'number')

const SPEC: CacheSpec<Limits> = {
  path: CTX_CACHE_PATH,
  version: 1,
  ttlMs: TTL_MS,
  validate: isLimits,
}

// limites resolvidos em memória (preenchidos pelo refresh)
const live = new Map<string, number>()

/** Limite síncrono pra UI: memória → tabela do models.ts (fallback). */
export const ctxLimit = (deployment: string): number =>
  live.get(deployment) ?? ctxLimitOf(deployment)

const applyToMemory = (limits: Limits): void => {
  for (const [dep, lim] of Object.entries(limits)) live.set(dep, lim)
}

// busca fresca no OpenRouter e mapeia pros nossos deployments
const fetchLimits = async (): Promise<Limits> => {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), 12_000)
  const res = await fetch(OPENROUTER_URL, { signal: ctrl.signal }).finally(() => clearTimeout(t))
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const json = (await res.json()) as { data: Array<{ id: string; context_length?: number }> }

  const limits: Limits = {}
  for (const m of MODELS) {
    const subs = MATCH[m.deployment]
    if (!subs) continue
    const hits = json.data.filter(d => subs.some(s => d.id.toLowerCase().includes(s)))
    if (!hits.length) continue
    const best = hits.reduce((a, b) => ((b.context_length ?? 0) > (a.context_length ?? 0) ? b : a))
    if (best.context_length) limits[m.deployment] = best.context_length
  }
  if (!Object.keys(limits).length) throw new Error('nenhuma janela mapeada')
  return limits
}

/**
 * Carrega as janelas no boot. Stale-while-revalidate: aplica o cache (mesmo
 * vencido) na hora e revalida em background; o onUpdate re-aplica e dispara a
 * UI. Até existir cache, a UI usa o fallback da tabela. `now` é injetado.
 */
export const refreshCtxWindows = async (now: number, onUpdate?: () => void): Promise<void> => {
  const data = await swr(SPEC, fetchLimits, now, limits => {
    applyToMemory(limits)
    onUpdate?.()
  })
  if (data) applyToMemory(data)
}
