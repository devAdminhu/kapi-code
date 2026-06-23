// Diff por linha (LCS) pra mostrar edições coloridas igual o Claude Code:
// linhas removidas (-) vermelhas, adicionadas (+) verdes, contexto neutro.

export type DiffLine = { type: 'add' | 'del' | 'ctx'; text: string; oldNo?: number; newNo?: number }

// LCS clássico entre dois arrays de linhas
const lcs = (a: string[], b: string[]): number[][] => {
  const m = a.length
  const n = b.length
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array<number>(n + 1).fill(0))
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      dp[i]![j] = a[i] === b[j] ? dp[i + 1]![j + 1]! + 1 : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!)
    }
  }
  return dp
}

/** Gera as linhas do diff entre `oldText` e `newText`. */
export const diffLines = (oldText: string, newText: string): DiffLine[] => {
  const a = oldText.split('\n')
  const b = newText.split('\n')
  const dp = lcs(a, b)
  const out: DiffLine[] = []
  let i = 0
  let j = 0
  let oldNo = 1
  let newNo = 1
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      out.push({ type: 'ctx', text: a[i]!, oldNo: oldNo++, newNo: newNo++ })
      i++
      j++
    } else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) {
      out.push({ type: 'del', text: a[i]!, oldNo: oldNo++ })
      i++
    } else {
      out.push({ type: 'add', text: b[j]!, newNo: newNo++ })
      j++
    }
  }
  while (i < a.length) out.push({ type: 'del', text: a[i++]!, oldNo: oldNo++ })
  while (j < b.length) out.push({ type: 'add', text: b[j++]!, newNo: newNo++ })
  return out
}

/**
 * Comprime o diff mostrando só as mudanças + N linhas de contexto ao redor,
 * colapsando trechos longos de contexto inalterado (igual o Claude Code).
 */
export const compactDiff = (lines: DiffLine[], context = 3): DiffLine[] => {
  const keep = new Array<boolean>(lines.length).fill(false)
  lines.forEach((l, i) => {
    if (l.type !== 'ctx') {
      for (let k = Math.max(0, i - context); k <= Math.min(lines.length - 1, i + context); k++) keep[k] = true
    }
  })
  const out: DiffLine[] = []
  let skipped = false
  lines.forEach((l, i) => {
    if (keep[i]) {
      out.push(l)
      skipped = false
    } else if (!skipped) {
      out.push({ type: 'ctx', text: '⋮' })
      skipped = true
    }
  })
  return out
}

export type DiffStat = { added: number; removed: number }
export const diffStat = (lines: DiffLine[]): DiffStat => ({
  added: lines.filter(l => l.type === 'add').length,
  removed: lines.filter(l => l.type === 'del').length,
})
