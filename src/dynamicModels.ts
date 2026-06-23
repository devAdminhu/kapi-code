// Descoberta dinâmica de modelos: pergunta a lista pra cada provider conectado
// e o back filtra só os melhores (allowlist por família + corta lixo). Os
// modelos estáticos (com preço curado) têm prioridade; os dinâmicos entram
// como complemento, com preço 0 (desconhecido) até alguém curar.

import { ALL_PROVIDERS, type Provider, type ProviderId } from './providers.js'
import { getCredential } from './auth.js'
import { registerModels, type ModelInfo } from './models.js'

// só as famílias boas de cada provider entram (o resto é ruído/legado)
const BEST: Partial<Record<ProviderId, RegExp>> = {
  anthropic: /^claude-(opus-4-[5-9]|sonnet-4-[6-9]|haiku-4-[5-9]|fable-5|mythos-5)/,
  openai: /^(gpt-5(\.\d+)?(-mini)?|o[34](-\w+)?)$/,
  google: /^gemini-3(\.\d+)?(-pro|-flash)?/,
  zai: /^glm-(4\.[6-9]|5(\.\d+)?)(-air|-flash)?$/,
  groq: /^(llama-3\.[3-9]|moonshotai\/|deepseek-)/,
  // openrouter e azure: catálogo gigante / por deployment → ficam no estático
}

// corta variantes que não servem pra chat de código, em qualquer provider
const JUNK = /(embed|whisper|tts|audio|realtime|image|vision|moderation|rerank|guard|dall-e|search|transcribe|speech|nano|lite|preview-\d|exp-\d|\d{8})/i

const modelsUrl = (p: Provider): string | null => {
  if (p.id === 'anthropic') return 'https://api.anthropic.com/v1/models'
  if (p.url.includes('/chat/completions')) return p.url.split('?')[0]!.replace('/chat/completions', '/models')
  return null
}

const aliasFromId = (id: string): string => (id.includes('/') ? id.slice(id.lastIndexOf('/') + 1) : id)

const fetchOne = async (p: Provider): Promise<ModelInfo[]> => {
  const best = BEST[p.id]
  if (!best) return []
  const url = modelsUrl(p)
  if (!url) return []
  const cred = getCredential(p.id)
  if (!cred) return []

  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  const authValue = cred.type === 'api' ? cred.key : cred.access
  if (p.id === 'anthropic') {
    headers['anthropic-version'] = '2023-06-01'
    if (cred.type === 'api') headers['x-api-key'] = authValue!
    else {
      headers.Authorization = `Bearer ${authValue}`
      headers['anthropic-beta'] = 'oauth-2025-04-20'
    }
  } else {
    headers.Authorization = `Bearer ${authValue}`
  }

  try {
    const res = await fetch(url, { headers })
    if (!res.ok) return []
    const json = (await res.json()) as { data?: Array<{ id?: string }> }
    const ids = (json.data ?? []).map(m => m.id).filter((x): x is string => !!x)
    return ids
      .filter(id => best.test(id) && !JUNK.test(id))
      .map(id => ({
        alias: aliasFromId(id),
        deployment: id,
        provider: p.id,
        inPrice: 0,
        outPrice: 0,
        ctxLimit: 200_000,
        note: 'dinâmico',
      }))
  } catch {
    return []
  }
}

/**
 * Busca os melhores modelos de todos os providers conectados e registra os
 * novos no catálogo. Roda em background no boot. Retorna o total adicionado.
 */
export const refreshDynamicModels = async (): Promise<number> => {
  const lists = await Promise.all(ALL_PROVIDERS.map(fetchOne))
  return registerModels(lists.flat())
}
