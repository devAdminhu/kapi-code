import { Fragment } from 'react'
import { Text } from 'ink'
import { theme } from '../theme.js'

// Realce leve: **negrito**, ~~tachado~~, `código` e blocos ``` mantêm dim/cor.
const INLINE = /(\*\*[^*]+\*\*|~~[^~]+~~|`[^`]+`)/g

// syntax highlight leve (sem dep externa): comentário, string, número, keyword.
// genérico o bastante pra JS/TS/Python/shell — cobre o comum dos code blocks.
const KEYWORDS = new Set([
  'const', 'let', 'var', 'function', 'return', 'if', 'else', 'for', 'while', 'import', 'export',
  'from', 'class', 'extends', 'new', 'await', 'async', 'def', 'print', 'lambda', 'elif', 'with',
  'as', 'yield', 'this', 'self', 'typeof', 'of', 'in', 'do', 'switch', 'case', 'break', 'continue',
  'try', 'catch', 'finally', 'throw', 'public', 'private', 'interface', 'type', 'enum', 'void',
  'not', 'and', 'or', 'is', 'true', 'false', 'null', 'undefined', 'True', 'False', 'None',
])
const CODE_TOKEN =
  /(\/\/[^\n]*|#[^\n]*|\/\*.*?\*\/)|('(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"|`(?:[^`\\]|\\.)*`)|(\b\d+(?:\.\d+)?\b)|([A-Za-z_$][A-Za-z0-9_$]*)/g

const highlightCode = (line: string, keyBase: string) => {
  const out: React.ReactNode[] = []
  let last = 0
  let m: RegExpExecArray | null
  CODE_TOKEN.lastIndex = 0
  let n = 0
  while ((m = CODE_TOKEN.exec(line))) {
    if (m.index > last) out.push(<Text key={`${keyBase}-g${n++}`} color={theme.kapiShimmer}>{line.slice(last, m.index)}</Text>)
    const [tok, comment, str, num, ident] = m
    if (comment) out.push(<Text key={`${keyBase}-c${n++}`} color={theme.subtle} italic>{tok}</Text>)
    else if (str) out.push(<Text key={`${keyBase}-s${n++}`} color={theme.success}>{tok}</Text>)
    else if (num) out.push(<Text key={`${keyBase}-n${n++}`} color={theme.accent}>{tok}</Text>)
    else if (ident && KEYWORDS.has(ident)) out.push(<Text key={`${keyBase}-k${n++}`} color={theme.kapi}>{tok}</Text>)
    else out.push(<Text key={`${keyBase}-i${n++}`} color={theme.kapiShimmer}>{tok}</Text>)
    last = m.index + tok.length
  }
  if (last < line.length) out.push(<Text key={`${keyBase}-t${n++}`} color={theme.kapiShimmer}>{line.slice(last)}</Text>)
  return out
}

const renderInline = (text: string, keyBase: string) => {
  const parts = text.split(INLINE)
  return parts.map((p, i) => {
    const key = `${keyBase}-${i}`
    if (p.startsWith('**') && p.endsWith('**')) {
      return (
        <Text key={key} bold>
          {p.slice(2, -2)}
        </Text>
      )
    }
    if (p.startsWith('~~') && p.endsWith('~~')) {
      return (
        <Text key={key} strikethrough>
          {p.slice(2, -2)}
        </Text>
      )
    }
    if (p.startsWith('`') && p.endsWith('`')) {
      return (
        <Text key={key} color={theme.accent}>
          {p.slice(1, -1)}
        </Text>
      )
    }
    return <Fragment key={key}>{p}</Fragment>
  })
}

// célula de tabela: separa por | e remove os pipes das pontas
const tableCells = (line: string): string[] => {
  const t = line.trim().replace(/^\|/, '').replace(/\|$/, '')
  return t.split('|').map(c => c.trim())
}
const isTableSep = (line: string): boolean => /^\s*\|?[\s:|-]+\|?\s*$/.test(line) && line.includes('-')
const isTableRow = (line: string): boolean => /\|/.test(line) && line.trim().startsWith('|')

// prescan: acha blocos de tabela (linha-header + separador + corpo) e devolve
// o nó renderizado por índice-inicial + os índices internos a pular no map.
const parseTables = (lines: string[], fenceMask: boolean[]) => {
  const nodes = new Map<number, React.ReactNode>()
  const skip = new Set<number>()
  for (let i = 0; i < lines.length; i++) {
    if (fenceMask[i] || skip.has(i)) continue
    const cur = lines[i] ?? ''
    const nxt = lines[i + 1] ?? ''
    if (!isTableRow(cur) || !isTableSep(nxt) || fenceMask[i + 1]) continue
    // coleta header + corpo
    const rows: string[][] = [tableCells(cur)]
    let j = i + 2
    while (j < lines.length && isTableRow(lines[j] ?? '') && !fenceMask[j]) {
      rows.push(tableCells(lines[j] ?? ''))
      j++
    }
    const ncol = Math.max(...rows.map(r => r.length))
    const w = Array.from({ length: ncol }, (_, c) => Math.max(...rows.map(r => (r[c] ?? '').length)))
    const pad = (s: string, c: number): string => (s ?? '').padEnd(w[c] ?? 0)
    const sepLine = w.map(width => '─'.repeat(width + 2)).join('┼').replace(/^./, '─').replace(/.$/, '─')
    nodes.set(i, (
      <Fragment key={`tbl-${i}`}>
        {rows.map((r, ri) => (
          <Fragment key={ri}>
            {ri === 1 && <Text color={theme.subtle}>{` ${sepLine}\n`}</Text>}
            <Text color={ri === 0 ? theme.kapiShimmer : theme.text} bold={ri === 0}>
              {' '}
              {Array.from({ length: ncol }, (_, c) => pad(r[c] ?? '', c)).join('  │  ')}
              {'\n'}
            </Text>
          </Fragment>
        ))}
      </Fragment>
    ))
    for (let k = i + 1; k < j; k++) skip.add(k)
  }
  return { nodes, skip }
}

export const Markdown = ({ text, color }: { text: string; color?: string }) => {
  const lines = text.split('\n')
  // máscara de fence pra não detectar tabela dentro de bloco de código
  const fenceMask: boolean[] = []
  {
    let f = false
    for (const ln of lines) {
      const isFenceMarker = ln.trimStart().startsWith('```')
      fenceMask.push(f && !isFenceMarker ? true : isFenceMarker ? true : false)
      if (isFenceMarker) f = !f
    }
  }
  const { nodes: tableNodes, skip: tableSkip } = parseTables(lines, fenceMask)
  let inFence = false
  return (
    <Text color={color ?? theme.text}>
      {lines.map((line, i) => {
        if (tableSkip.has(i)) return null
        if (tableNodes.has(i)) return tableNodes.get(i)
        const nl = i < lines.length - 1 ? '\n' : ''
        if (line.trimStart().startsWith('```')) {
          inFence = !inFence
          return (
            <Text key={i} color={theme.subtle}>
              {line}
              {nl}
            </Text>
          )
        }
        if (inFence) {
          return (
            <Text key={i}>
              {highlightCode(line, `c${i}`)}
              {nl}
            </Text>
          )
        }
        // heading (#, ##, …) — bold com leve cor de destaque
        const heading = line.match(/^(#{1,6})\s+(.*)$/)
        if (heading) {
          return (
            <Text key={i} bold color={theme.kapiShimmer}>
              {renderInline(heading[2] ?? '', String(i))}
              {nl}
            </Text>
          )
        }
        // bullet (-, *, +) — troca o marcador por • mantendo a indentação
        const bullet = line.match(/^(\s*)[-*+]\s+(.*)$/)
        if (bullet) {
          return (
            <Text key={i}>
              {bullet[1]}
              <Text color={theme.accent}>• </Text>
              {renderInline(bullet[2] ?? '', String(i))}
              {nl}
            </Text>
          )
        }
        // lista numerada (1. 2. …) — número realçado
        const ordered = line.match(/^(\s*)(\d+)\.\s+(.*)$/)
        if (ordered) {
          return (
            <Text key={i}>
              {ordered[1]}
              <Text color={theme.accent}>{ordered[2]}. </Text>
              {renderInline(ordered[3] ?? '', String(i))}
              {nl}
            </Text>
          )
        }
        // citação (>)
        const quote = line.match(/^\s*>\s?(.*)$/)
        if (quote) {
          return (
            <Text key={i} color={theme.dim} italic>
              {'│ '}
              {renderInline(quote[1] ?? '', String(i))}
              {nl}
            </Text>
          )
        }
        return (
          <Text key={i}>
            {renderInline(line, String(i))}
            {nl}
          </Text>
        )
      })}
    </Text>
  )
}
