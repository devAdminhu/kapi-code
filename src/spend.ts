import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { SPEND_PATH } from './config.js'
import { costOf } from './models.js'

export type Spend = {
  total_usd: number
  in_tokens: number
  out_tokens: number
  by_model: Record<string, number>
}

const empty = (): Spend => ({ total_usd: 0, in_tokens: 0, out_tokens: 0, by_model: {} })

export const loadSpend = (): Spend => {
  if (!existsSync(SPEND_PATH)) return empty()
  try {
    const parsed = JSON.parse(readFileSync(SPEND_PATH, 'utf-8')) as Partial<Spend>
    return {
      total_usd: parsed.total_usd ?? 0,
      in_tokens: parsed.in_tokens ?? 0,
      out_tokens: parsed.out_tokens ?? 0,
      by_model: parsed.by_model ?? {},
    }
  } catch {
    return empty()
  }
}

const saveSpend = (s: Spend): void => {
  try {
    mkdirSync(dirname(SPEND_PATH), { recursive: true })
    writeFileSync(SPEND_PATH, JSON.stringify(s, null, 2))
  } catch {
    // gasto é best-effort, não derruba a sessão
  }
}

/** Registra uma chamada e devolve o gasto atualizado + custo dessa chamada. */
export const registerUsage = (
  deployment: string,
  inTok: number,
  outTok: number,
): { spend: Spend; cost: number } => {
  const cost = costOf(deployment, inTok, outTok)
  const s = loadSpend()
  if (!inTok && !outTok) return { spend: s, cost: 0 }
  s.total_usd += cost
  s.in_tokens += inTok
  s.out_tokens += outTok
  s.by_model[deployment] = (s.by_model[deployment] ?? 0) + cost
  saveSpend(s)
  return { spend: s, cost }
}
