import { readFileSync, existsSync, renameSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

// versão do app (package.json) — fonte única pra UI toda
export const APP_VERSION: string = (() => {
  try {
    const pkg = JSON.parse(
      readFileSync(new URL('../package.json', import.meta.url), 'utf-8'),
    ) as { version?: string }
    return pkg.version ?? '0.0.0'
  } catch {
    return '0.0.0'
  }
})()

export const CREDIT_TOTAL = 200.0 // crédito Free Trial Azure

// pasta própria do Kapi (espelha ~/.claude do Claude Code).
// ~/.kapi-code e NÃO ~/.kapi: o ~/.kapi já pertence ao fork kapi-code do
// Claude Code que o João usa — não misturar configs das duas ferramentas
export const KAPI_DIR = join(homedir(), '.kapi-code')
const LEGACY_DIR = join(homedir(), '.jarvis') // era Jarvis antes do rename

// migração automática do rename: ~/.jarvis vira ~/.kapi (memória, sessão,
// cache, logs de bg — tudo preservado). Roda uma vez, best-effort.
try {
  if (!existsSync(KAPI_DIR) && existsSync(LEGACY_DIR)) {
    renameSync(LEGACY_DIR, KAPI_DIR)
  }
  const legacyMd = join(KAPI_DIR, 'JARVIS.md')
  if (existsSync(legacyMd) && !existsSync(join(KAPI_DIR, 'KAPI.md'))) {
    renameSync(legacyMd, join(KAPI_DIR, 'KAPI.md'))
  }
} catch {
  // sem permissão/raça: segue com o que existir
}

export const GLOBAL_INSTRUCTION = join(KAPI_DIR, 'KAPI.md') // instruções globais
export const MEMORY_PATH = join(KAPI_DIR, 'memory.md') // memória persistente
export const CTX_CACHE_PATH = join(KAPI_DIR, 'ctxwindow.json') // cache janela de contexto
export const SESSION_PATH = join(KAPI_DIR, 'last-session.json') // última sessão (kapi -c)

// gasto fica em ~/.azure-sp — nome antigo de propósito: compartilhado com a
// CLI jarvis em Python, que soma no mesmo arquivo
export const SPEND_PATH = join(homedir(), '.azure-sp', 'jarvis-gasto.json')

// arquivos de instruções procurados no diretório do PROJETO (pasta atual);
// JARVIS.md fica como fallback pra projetos que ainda têm o nome antigo
export const INSTRUCTION_FILES = ['KAPI.md', 'AGENTS.md', 'JARVIS.md']

// .azure-ref.env mora na pasta real do projeto
const ENV_CANDIDATES = [
  join(homedir(), 'kapi-code', '.azure-ref.env'),
  join(homedir(), '.azure-sp', 'claude-mcp.env'),
]

// endpoint OpenAI-compatible testado e funcionando
export const API_URL =
  'https://eastus2.api.cognitive.microsoft.com/openai/v1/chat/completions?api-version=preview'

// z.ai (GLM) — endpoint OpenAI-compatible geral (billing normal)
export const ZAI_URL = 'https://api.z.ai/api/paas/v4/chat/completions'

const parseEnv = (raw: string): Record<string, string> => {
  const out: Record<string, string> = {}
  for (const line of raw.split('\n')) {
    const t = line.trim()
    if (!t || t.startsWith('#') || !t.includes('=')) continue
    const idx = t.indexOf('=')
    out[t.slice(0, idx)] = t.slice(idx + 1)
  }
  return out
}

/** Lê a chave da Azure de env var ou dos arquivos gitignored (aceita o nome novo e o legado). */
export const loadApiKey = (): string => {
  const fromEnv = process.env.KAPI_API_KEY ?? process.env.JARVIS_DEEPSEEK_KEY
  if (fromEnv) return fromEnv
  for (const path of ENV_CANDIDATES) {
    if (!existsSync(path)) continue
    const vars = parseEnv(readFileSync(path, 'utf-8'))
    const key = vars.KAPI_API_KEY ?? vars.JARVIS_DEEPSEEK_KEY
    if (key) return key
  }
  throw new Error(
    `chave da Azure não encontrada. Defina KAPI_API_KEY ou crie ${ENV_CANDIDATES[0]}`,
  )
}

/** Lê a chave da z.ai (GLM) de env var ou dos arquivos gitignored. */
export const loadZaiKey = (): string => {
  const fromEnv = process.env.ZAI_API_KEY
  if (fromEnv) return fromEnv
  for (const path of ENV_CANDIDATES) {
    if (!existsSync(path)) continue
    const key = parseEnv(readFileSync(path, 'utf-8')).ZAI_API_KEY
    if (key) return key
  }
  throw new Error(`chave da z.ai não encontrada. Defina ZAI_API_KEY ou adicione em ${ENV_CANDIDATES[0]}`)
}
