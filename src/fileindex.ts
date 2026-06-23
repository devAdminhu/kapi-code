// Índice de arquivos do projeto pra menção com @ (estilo Claude Code).
// Fonte rápida: `git ls-files` (respeita .gitignore, instantâneo). Fora de um
// repo, cai num walk raso. Cacheado por processo; busca fuzzy por subsequência.

import { execFileSync } from 'node:child_process'
import { readdirSync } from 'node:fs'
import { join, relative } from 'node:path'

let cache: string[] | null = null

const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', '.next', 'coverage', '.cache'])

const walk = (dir: string, root: string, out: string[], depth: number): void => {
  if (depth > 6 || out.length > 20_000) return
  let entries
  try {
    entries = readdirSync(dir, { withFileTypes: true, encoding: 'utf-8' })
  } catch {
    return
  }
  for (const e of entries) {
    if (e.name.startsWith('.') && e.name !== '.env.example') continue
    if (e.isDirectory()) {
      if (SKIP_DIRS.has(e.name)) continue
      walk(join(dir, e.name), root, out, depth + 1)
    } else if (e.isFile()) {
      out.push(relative(root, join(dir, e.name)))
    }
  }
}

export const projectFiles = (): string[] => {
  if (cache) return cache
  const cwd = process.cwd()
  try {
    const out = execFileSync('git', ['ls-files'], { cwd, encoding: 'utf-8', maxBuffer: 32 * 1024 * 1024 })
    const files = out.split('\n').filter(Boolean)
    if (files.length) {
      cache = files
      return cache
    }
  } catch {
    // sem git: walk
  }
  const out: string[] = []
  walk(cwd, cwd, out, 0)
  cache = out
  return cache
}

// match por subsequência (fuzzy): "apptsx" casa "src/ui/App.tsx".
// pontua: básico no fim do caminho (basename) e match mais curto rankeiam melhor.
const fuzzy = (query: string, path: string): number | null => {
  const q = query.toLowerCase()
  const p = path.toLowerCase()
  let qi = 0
  for (let pi = 0; pi < p.length && qi < q.length; pi++) {
    if (p[pi] === q[qi]) qi++
  }
  if (qi < q.length) return null
  const base = p.slice(p.lastIndexOf('/') + 1)
  let score = p.length
  if (base.includes(q)) score -= 1000 // match contíguo no nome do arquivo
  if (base.startsWith(q)) score -= 500
  return score
}

export const filterFiles = (query: string, limit = 8): string[] => {
  const files = projectFiles()
  if (!query) return files.slice(0, limit)
  return files
    .map(f => ({ f, s: fuzzy(query, f) }))
    .filter((x): x is { f: string; s: number } => x.s !== null)
    .sort((a, b) => a.s - b.s)
    .slice(0, limit)
    .map(x => x.f)
}
