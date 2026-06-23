// Persiste a última sessão pra retomar com `kapi -c` (igual claude --continue).
import { readFileSync, writeFileSync, renameSync, existsSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { SESSION_PATH } from './config.js'
import type { ChatMessage } from './api/types.js'
import type { ChatItem } from './engine.js'

type SavedSession = { savedAt: string; cwd: string; history: ChatMessage[]; items: ChatItem[] }

export const saveSession = (history: ChatMessage[], items: ChatItem[]): void => {
  // não salva sessão vazia (só o system)
  if (history.length <= 1) return
  try {
    mkdirSync(dirname(SESSION_PATH), { recursive: true })
    const data: SavedSession = {
      savedAt: new Date().toISOString(),
      cwd: process.cwd(),
      history,
      items,
    }
    const tmp = `${SESSION_PATH}.tmp`
    writeFileSync(tmp, JSON.stringify(data))
    renameSync(tmp, SESSION_PATH)
  } catch {
    // best-effort
  }
}

export const loadSession = (): { history: ChatMessage[]; items: ChatItem[] } | null => {
  if (!existsSync(SESSION_PATH)) return null
  try {
    const data = JSON.parse(readFileSync(SESSION_PATH, 'utf-8')) as SavedSession
    if (!Array.isArray(data.history) || data.history.length <= 1) return null
    return { history: data.history, items: data.items ?? [] }
  } catch {
    return null
  }
}
