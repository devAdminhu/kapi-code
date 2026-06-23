// Cache em disco robusto, local, sem dependências externas.
//
// Garantias (best practice pra cache de arquivo):
//  - escrita ATÔMICA: grava em <file>.tmp e faz rename() (atômico no POSIX),
//    então um crash no meio nunca deixa o cache corrompido/truncado
//  - schema VERSIONADO: cada entrada é { v, fetchedAt, data }; versão diferente
//    da esperada é tratada como miss (evita quebrar parse ao mudar formato)
//  - VALIDAÇÃO na leitura: JSON inválido ou forma errada → miss silencioso
//  - STALE-WHILE-REVALIDATE: serve o valor cacheado na hora (mesmo vencido) e
//    dispara o refresh em background; a UI nunca espera a rede
//  - degrada GRACIOSO: qualquer erro de I/O é engolido; o chamador usa fallback
//
// Date.now() é injetado pelo chamador (não é permitido em alguns contextos do
// runtime), então o cache nunca chama o relógio sozinho.

import { readFileSync, writeFileSync, renameSync, existsSync, mkdirSync, unlinkSync } from 'node:fs'
import { dirname } from 'node:path'

// envelope no mesmo formato do Claude Code: { version, fetchedAt(ISO), data }.
// guardamos fetchedAt como epoch ms (fetchedAtMs) pra TTL e como ISO legível.
type Envelope<T> = { version: number; fetchedAt: string; fetchedAtMs: number; data: T }

export type CacheSpec<T> = {
  /** caminho do arquivo no disco */
  path: string
  /** versão do schema; bump invalida caches antigos */
  version: number
  /** tempo de vida em ms; depois disso o valor é "stale" (mas ainda servível) */
  ttlMs: number
  /** valida a forma de `data` lido do disco; retorna false pra tratar como miss */
  validate: (data: unknown) => data is T
}

export type CacheState<T> =
  | { status: 'miss' } // nada utilizável em disco
  | { status: 'fresh'; data: T } // dentro do TTL
  | { status: 'stale'; data: T; fetchedAt: number } // vencido, mas servível

const ensureDir = (path: string): void => {
  mkdirSync(dirname(path), { recursive: true })
}

/** Lê e valida o cache. Nunca lança; lixo vira `miss`. */
export const readCache = <T>(spec: CacheSpec<T>, now: number): CacheState<T> => {
  if (!existsSync(spec.path)) return { status: 'miss' }
  let raw: string
  try {
    raw = readFileSync(spec.path, 'utf-8')
  } catch {
    return { status: 'miss' }
  }
  let env: Envelope<unknown>
  try {
    env = JSON.parse(raw) as Envelope<unknown>
  } catch {
    return { status: 'miss' }
  }
  // forma do envelope + versão + validação do payload
  if (
    !env ||
    typeof env !== 'object' ||
    env.version !== spec.version ||
    typeof env.fetchedAtMs !== 'number' ||
    !spec.validate(env.data)
  ) {
    return { status: 'miss' }
  }
  const age = now - env.fetchedAtMs
  if (age >= 0 && age < spec.ttlMs) return { status: 'fresh', data: env.data }
  return { status: 'stale', data: env.data, fetchedAt: env.fetchedAtMs }
}

/** Grava de forma atômica (tmp + rename). Best-effort: erros são engolidos. */
export const writeCache = <T>(spec: CacheSpec<T>, data: T, now: number): void => {
  const env: Envelope<T> = {
    version: spec.version,
    fetchedAt: new Date(now).toISOString(),
    fetchedAtMs: now,
    data,
  }
  const tmp = `${spec.path}.tmp`
  try {
    ensureDir(spec.path)
    writeFileSync(tmp, JSON.stringify(env, null, 2))
    renameSync(tmp, spec.path) // troca atômica
  } catch {
    // limpa o tmp se sobrou
    try {
      if (existsSync(tmp)) unlinkSync(tmp)
    } catch {
      /* nada a fazer */
    }
  }
}

// dedup de refreshes concorrentes por path (não dispara 2x o mesmo fetch)
const inflight = new Set<string>()

/**
 * Stale-while-revalidate. Resolve IMEDIATAMENTE com o que houver em disco
 * (fresh ou stale) e, se não estiver fresh, dispara `fetcher` em background pra
 * atualizar o disco. O `onUpdate` opcional é chamado quando o refresh termina,
 * pra UI re-renderizar. Retorna o dado disponível agora, ou null em miss.
 */
export const swr = async <T>(
  spec: CacheSpec<T>,
  fetcher: () => Promise<T>,
  now: number,
  onUpdate?: (data: T) => void,
): Promise<T | null> => {
  const state = readCache(spec, now)
  const cached = state.status === 'miss' ? null : state.data

  const needsRefresh = state.status !== 'fresh'
  if (needsRefresh && !inflight.has(spec.path)) {
    inflight.add(spec.path)
    const refresh = fetcher()
      .then(data => {
        writeCache(spec, data, now)
        onUpdate?.(data)
        return data
      })
      .catch(() => null)
      .finally(() => inflight.delete(spec.path))

    // miss total: precisa esperar o fetch (não há stale pra servir)
    if (cached === null) return refresh
  }

  return cached
}
