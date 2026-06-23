// Armazena credenciais dos providers em ~/.kapi-code/auth.json (chmod 600),
// no mesmo espírito do opencode. Aceita API key colada ou tokens OAuth.
// Resolução de credencial cai pra env var / .azure-ref.env (retrocompat Azure/zai).

import { readFileSync, writeFileSync, existsSync, chmodSync } from 'node:fs'
import { join } from 'node:path'
import { KAPI_DIR, loadApiKey, loadZaiKey } from './config.js'
import { PROVIDERS, type ProviderId } from './providers.js'

const AUTH_PATH = join(KAPI_DIR, 'auth.json')

export type Credential =
  | { type: 'api'; key: string }
  | { type: 'oauth'; access: string; refresh?: string; expires?: number }

type AuthStore = Partial<Record<ProviderId, Credential>>

export const loadAuth = (): AuthStore => {
  if (!existsSync(AUTH_PATH)) return {}
  try {
    return JSON.parse(readFileSync(AUTH_PATH, 'utf-8')) as AuthStore
  } catch {
    return {}
  }
}

export const saveAuth = (store: AuthStore): void => {
  writeFileSync(AUTH_PATH, JSON.stringify(store, null, 2), { mode: 0o600 })
  try {
    chmodSync(AUTH_PATH, 0o600)
  } catch {
    /* best-effort */
  }
}

export const setCredential = (provider: ProviderId, cred: Credential): void => {
  const store = loadAuth()
  store[provider] = cred
  saveAuth(store)
}

export const setKey = (provider: ProviderId, key: string): void =>
  setCredential(provider, { type: 'api', key })

export const removeCredential = (provider: ProviderId): void => {
  const store = loadAuth()
  delete store[provider]
  saveAuth(store)
}

// lê uma var de .azure-ref.env sem expor as outras (retrocompat das chaves antigas)
const envFileVar = (name: string): string | undefined => {
  const path = join(process.env.HOME ?? '', 'kapi-code', '.azure-ref.env')
  if (!existsSync(path)) return undefined
  for (const line of readFileSync(path, 'utf-8').split('\n')) {
    const t = line.trim()
    if (!t || t.startsWith('#') || !t.includes('=')) continue
    const i = t.indexOf('=')
    if (t.slice(0, i) === name) return t.slice(i + 1)
  }
  return undefined
}

/**
 * Resolve a credencial efetiva de um provider:
 * auth.json → env var do provider → .azure-ref.env. null se não houver.
 */
export const getCredential = (provider: ProviderId): Credential | null => {
  const stored = loadAuth()[provider]
  if (stored) return stored
  // azure e zai têm loaders próprios que aceitam os nomes legados (.azure-ref.env)
  try {
    if (provider === 'azure') return { type: 'api', key: loadApiKey() }
    if (provider === 'zai') return { type: 'api', key: loadZaiKey() }
  } catch {
    /* sem chave legada: cai pro env var genérico */
  }
  const envVar = PROVIDERS[provider].envVar
  if (envVar) {
    const fromEnv = process.env[envVar] ?? envFileVar(envVar)
    if (fromEnv) return { type: 'api', key: fromEnv }
  }
  return null
}

export const isConnected = (provider: ProviderId): boolean => getCredential(provider) !== null
