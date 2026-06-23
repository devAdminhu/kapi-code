// Carrega instruções (KAPI.md/AGENTS.md) e memória persistente, e monta o
// system prompt: base + instruções (~ e dir atual) + memória.
import { readFileSync, writeFileSync, existsSync, mkdirSync, appendFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { GLOBAL_INSTRUCTION, INSTRUCTION_FILES, MEMORY_PATH } from './config.js'
import { envBlock } from './env.js'

type LoadedFile = { path: string; content: string }

const readFile = (path: string): LoadedFile | null => {
  if (!existsSync(path)) return null
  try {
    const content = readFileSync(path, 'utf-8').trim()
    return content ? { path, content } : null
  } catch {
    return null
  }
}

// procura o primeiro arquivo de instrução existente num diretório (projeto)
const findIn = (dir: string): LoadedFile | null => {
  for (const name of INSTRUCTION_FILES) {
    const f = readFile(join(dir, name))
    if (f) return f
  }
  return null
}

/**
 * Instruções carregadas no boot, igual o Claude Code:
 *   1. global  → ~/.kapi-code/KAPI.md
 *   2. projeto → KAPI.md/AGENTS.md na pasta atual
 * O projeto vem por último (tem a palavra final no comportamento).
 */
export const loadInstructions = (): LoadedFile[] => {
  const out: LoadedFile[] = []
  const global = readFile(GLOBAL_INSTRUCTION)
  if (global) out.push(global)
  const cwd = process.cwd()
  if (cwd !== homedir()) {
    const local = findIn(cwd)
    if (local && local.path !== global?.path) out.push(local)
  }
  return out
}

/** Conteúdo da memória persistente (vazio se não existe). */
export const loadMemory = (): string => {
  if (!existsSync(MEMORY_PATH)) return ''
  try {
    return readFileSync(MEMORY_PATH, 'utf-8').trim()
  } catch {
    return ''
  }
}

/** Acrescenta um fato à memória persistente (cria o arquivo se preciso). */
export const appendMemory = (fact: string): void => {
  const clean = fact.trim()
  if (!clean) return
  mkdirSync(dirname(MEMORY_PATH), { recursive: true })
  if (!existsSync(MEMORY_PATH)) {
    writeFileSync(MEMORY_PATH, '# Memória do Kapi\n\n')
  }
  appendFileSync(MEMORY_PATH, `- ${clean}\n`)
}

/**
 * Monta o system prompt final: base + ambiente dinâmico + instruções + memória.
 * Tudo que existir é concatenado por baixo do base, com cabeçalhos claros.
 */
export const buildSystemPrompt = (base: string): string => {
  const parts = [base, envBlock(new Date())]

  const instructions = loadInstructions()
  for (const f of instructions) {
    parts.push(`# Instruções do projeto (${f.path})\n\n${f.content}`)
  }

  const memory = loadMemory()
  if (memory) {
    parts.push(`# Memória persistente (fatos que o usuário pediu pra lembrar)\n\n${memory}`)
  }

  return parts.join('\n\n---\n\n')
}

/** Resumo curto do que foi carregado, pra mostrar no boot. */
export const contextSummary = (): string => {
  const instr = loadInstructions()
  const mem = loadMemory()
  const bits: string[] = []
  for (const f of instr) bits.push(f.path.replace(homedir(), '~'))
  if (mem) bits.push(`memória (${mem.split('\n').filter(l => l.trim().startsWith('-')).length} fatos)`)
  return bits.join(' · ')
}
