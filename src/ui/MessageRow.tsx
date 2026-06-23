import { Box, Text } from 'ink'
import { theme } from '../theme.js'
import { TOOL_ICON } from '../tools.js'
import type { ChatItem } from '../engine.js'
import type { DiffLine } from '../diff.js'
import { diffStat } from '../diff.js'
import { Markdown } from './Markdown.js'
import { useTermSize } from './useTermSize.js'

// largura do marcador à esquerda (● / ❯ / espaço) — estilo Claude Code
const GUTTER = 2

// diff colorido igual o Claude Code: - vermelho, + verde, contexto neutro.
// linha truncada na largura do terminal (sem wrap feio no meio do código)
const DiffView = ({ diff }: { diff: DiffLine[] }) => {
  const { cols } = useTermSize()
  const maxW = Math.max(20, cols - 11) // gutter + nº da linha + sinal + folga
  const { added, removed } = diffStat(diff)
  return (
    <Box flexDirection="column">
      <Box>
        <Box width={GUTTER} flexShrink={0}>
          <Text> </Text>
        </Box>
        <Text color={theme.subtle}>
          ⎿  Added {added} line{added === 1 ? '' : 's'}, removed {removed} line{removed === 1 ? '' : 's'}
        </Text>
      </Box>
      {diff.slice(0, 40).map((l, i) => {
        const no = l.type === 'add' ? l.newNo : l.oldNo
        const sign = l.type === 'add' ? '+' : l.type === 'del' ? '-' : ' '
        const color = l.type === 'add' ? theme.success : l.type === 'del' ? theme.error : theme.subtle
        const bg = l.type === 'add' ? '#0e2a14' : l.type === 'del' ? '#2a0e14' : undefined
        // estilo Claude Code: fundo cobre a linha inteira (pad até maxW), não só o texto
        const body = `${sign} ${truncate(l.text, maxW)}`
        const filled = bg ? body.padEnd(maxW + 2) : body
        return (
          <Box key={i}>
            <Box width={GUTTER} flexShrink={0}>
              <Text> </Text>
            </Box>
            <Text color={theme.subtle}>{String(no ?? '').padStart(4)} </Text>
            <Text color={color} backgroundColor={bg}>
              {filled}
            </Text>
          </Box>
        )
      })}
      {diff.length > 40 && (
        <Box>
          <Box width={GUTTER} flexShrink={0}>
            <Text> </Text>
          </Box>
          <Text color={theme.subtle}>… (+{diff.length - 40} linhas)</Text>
        </Box>
      )}
    </Box>
  )
}

const truncate = (s: string, n: number): string => (s.length > n ? `${s.slice(0, n)}…` : s)

// todo list estilo Claude Code: cada tarefa numa linha, checkbox colorido.
// ☒ feito → verde + tachado · ▣ fazendo → ciano bold · ☐ pendente → neutro
const TodoView = ({ result }: { result: string }) => (
  <Box flexDirection="column">
    {result.split('\n').map((line, i) => {
      const done = line.startsWith('☒')
      const doing = line.startsWith('▣')
      const color = done ? theme.success : doing ? theme.kapi : theme.dim
      const text = line.slice(line.indexOf(' ') + 1)
      const mark = line.slice(0, line.indexOf(' '))
      return (
        <Box key={i}>
          <Box width={GUTTER} flexShrink={0}>
            <Text> </Text>
          </Box>
          <Text color={color}>{mark} </Text>
          <Text color={done ? theme.subtle : doing ? theme.text : theme.dim} strikethrough={done} bold={doing}>
            {text}
          </Text>
        </Box>
      )
    })}
  </Box>
)

export type ReasoningMode = 'full' | 'short' | 'hidden'

// marcador colorido à esquerda + corpo (sem nome/prefixo, estilo Claude Code)
const Row = ({ mark, color, children }: { mark: string; color: string; children: React.ReactNode }) => (
  <Box flexDirection="row" marginBottom={1}>
    <Box width={GUTTER} flexShrink={0}>
      <Text bold color={color}>
        {mark}
      </Text>
    </Box>
    <Box flexDirection="column" flexGrow={1}>
      {children}
    </Box>
  </Box>
)

export const MessageRow = ({
  item,
  reasoningMode = 'short',
}: {
  item: ChatItem
  reasoningMode?: ReasoningMode
}) => {
  switch (item.kind) {
    case 'user':
      return (
        <Row mark="❯" color={theme.subtle}>
          <Text color={theme.dim}>{item.text}</Text>
        </Row>
      )

    case 'assistant':
      return (
        <Row mark="●" color={theme.kapi}>
          {item.reasoning && reasoningMode !== 'hidden' && (
            <Box marginBottom={item.text ? 1 : 0} flexDirection="column">
              <Text color={theme.subtle} italic>
                {reasoningMode === 'full'
                  ? item.reasoning.trim()
                  : truncate(item.reasoning.replace(/\s+/g, ' ').trim(), 240)}
              </Text>
            </Box>
          )}
          {item.text ? <Markdown text={item.text} /> : null}
          {typeof item.cost === 'number' && item.cost > 0 && (
            <Text color={theme.subtle}> ↳ ${item.cost.toFixed(5)}</Text>
          )}
        </Row>
      )

    case 'tool': {
      const icon = TOOL_ICON[item.name] ?? '•'
      const result = truncate(item.result.replace(/\n+/g, ' ').trim(), 300)
      return (
        <Box flexDirection="column" marginBottom={1}>
          <Box>
            <Box width={GUTTER} flexShrink={0}>
              <Text> </Text>
            </Box>
            <Text color={theme.tool} bold>
              {icon} {item.name}
            </Text>
            <Text color={theme.dim}> {truncate(item.preview, 120)}</Text>
          </Box>
          {item.diff && item.diff.length > 0 ? (
            <DiffView diff={item.diff} />
          ) : item.name === 'tarefas' && !item.refused ? (
            <TodoView result={item.result} />
          ) : (
            <Box>
              <Box width={GUTTER} flexShrink={0}>
                <Text> </Text>
              </Box>
              <Text color={item.refused ? theme.error : theme.subtle}>⎿ {result}</Text>
            </Box>
          )}
        </Box>
      )
    }

    case 'system': {
      const color =
        item.tone === 'error' ? theme.error : item.tone === 'warn' ? theme.warning : theme.dim
      return (
        <Box marginBottom={1}>
          <Box width={GUTTER} flexShrink={0}>
            <Text> </Text>
          </Box>
          <Text color={color}>{item.text}</Text>
        </Box>
      )
    }

    case 'swarm':
      return (
        <Box flexDirection="column" marginBottom={1}>
          <Box>
            <Box width={GUTTER} flexShrink={0}>
              <Text> </Text>
            </Box>
            <Text color={theme.accent} bold>
              🐝 enxame
            </Text>
            <Text color={theme.dim}> {truncate(item.objetivo, 80)}</Text>
          </Box>
          {item.agentes.map((a, i) => (
            <Box key={i}>
              <Box width={GUTTER} flexShrink={0}>
                <Text> </Text>
              </Box>
              <Text color={a.ok ? theme.success : theme.error}>{a.ok ? '✓' : '✗'} </Text>
              <Text color={theme.tool}>{a.tipo} </Text>
              <Text color={theme.dim}>{truncate(a.tarefa, 60)}</Text>
            </Box>
          ))}
        </Box>
      )
  }
}
