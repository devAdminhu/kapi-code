import { useState } from 'react'
import { Box, Text, useInput } from 'ink'
import { theme } from '../theme.js'
import { MODELS, aliasOf } from '../models.js'
import { APP_VERSION, CREDIT_TOTAL } from '../config.js'
import type { Spend } from '../spend.js'
import { useTermSize } from './useTermSize.js'
import { isConnected } from '../auth.js'

// seletor interativo: ↑↓ navega, Enter troca o modelo, Esc fecha
export const ModelsPanel = ({
  current,
  onSelect,
  onClose,
}: {
  current: string
  onSelect: (deployment: string) => void
  onClose: () => void
}) => {
  const [sel, setSel] = useState(() =>
    Math.max(0, MODELS.findIndex(m => m.deployment === current)),
  )
  const { cols } = useTermSize()
  // responsivo: derruba colunas menos importantes em terminal estreito
  const showDeployment = cols >= 88
  const showNote = cols >= 70
  const showPrice = cols >= 52

  useInput((input, key) => {
    if (key.upArrow) return setSel(s => (s - 1 + MODELS.length) % MODELS.length)
    if (key.downArrow) return setSel(s => (s + 1) % MODELS.length)
    if (key.return) {
      const m = MODELS[sel]
      if (m) onSelect(m.deployment)
      return
    }
    if (key.escape || input === 'q') onClose()
  })

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={theme.border}
      paddingX={1}
      marginBottom={1}
    >
      <Text bold color={theme.kapi}>
        modelos disponíveis (preço $/1M tokens)
      </Text>
      <Box marginTop={1} flexDirection="column">
        {MODELS.map((m, i) => {
          const active = m.deployment === current
          const focused = i === sel
          const on = isConnected(m.provider)
          return (
            <Box key={m.alias}>
              <Text color={focused ? theme.accent : theme.dim}>{focused ? '› ' : '  '}</Text>
              <Text color={on ? theme.success : theme.subtle}>{on ? '● ' : '○ '}</Text>
              <Box width={11}>
                <Text bold color={focused ? theme.accent : active ? theme.kapi : on ? theme.text : theme.subtle} inverse={focused}>
                  {m.alias}
                </Text>
              </Box>
              {showDeployment && (
                <Box width={22}>
                  <Text color={focused ? theme.text : theme.dim}>{m.deployment}</Text>
                </Box>
              )}
              {showPrice && (
                <Box width={20}>
                  <Text color={theme.subtle}>
                    in ${m.inPrice} · out ${m.outPrice}
                  </Text>
                </Box>
              )}
              {showNote && <Text color={theme.subtle}>{m.note}</Text>}
              {active && <Text color={theme.successBright}> ✓ atual</Text>}
            </Box>
          )
        })}
      </Box>
      <Box marginTop={1}>
        <Text color={theme.subtle}>↑↓ navega · Enter seleciona · Esc fecha · ○ sem credencial (/login)</Text>
      </Box>
    </Box>
  )
}

export const SpendPanel = ({ spend }: { spend: Spend }) => {
  const used = spend.total_usd
  const left = CREDIT_TOTAL - used
  const pct = (used / CREDIT_TOTAL) * 100
  const filled = Math.min(20, Math.round(pct / 5))
  const bar = '█'.repeat(filled) + '░'.repeat(20 - filled)
  const col = pct > 80 ? theme.error : pct > 50 ? theme.warning : theme.successBright

  const byModel = Object.entries(spend.by_model).sort(([, a], [, b]) => b - a)

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={theme.border}
      paddingX={1}
      marginBottom={1}
    >
      <Text bold color={theme.kapi}>
        gasto acumulado (estimado)
      </Text>
      <Box marginTop={1}>
        <Text color={theme.dim}>tokens: </Text>
        <Text color={theme.text}>{spend.in_tokens.toLocaleString('pt-BR')} in</Text>
        <Text color={theme.dim}> · </Text>
        <Text color={theme.text}>{spend.out_tokens.toLocaleString('pt-BR')} out</Text>
      </Box>
      <Box>
        <Text color={theme.dim}>gasto: </Text>
        <Text color={col} bold>
          ${used.toFixed(4)}
        </Text>
        <Text color={theme.dim}> de ${CREDIT_TOTAL.toFixed(0)} </Text>
        <Text color={col}>[{bar}]</Text>
        <Text color={theme.dim}> {pct.toFixed(2)}%</Text>
      </Box>
      <Box>
        <Text color={theme.dim}>resta: </Text>
        <Text color={col} bold>
          ${left.toFixed(2)}
        </Text>
      </Box>
      {byModel.length > 0 && (
        <Box flexDirection="column" marginTop={1}>
          {byModel.map(([dep, c]) => (
            <Box key={dep}>
              <Box width={13}>
                <Text color={theme.subtle}>{aliasOf(dep)}</Text>
              </Box>
              <Text color={theme.subtle}>${c.toFixed(5)}</Text>
            </Box>
          ))}
        </Box>
      )}
    </Box>
  )
}

// rodapé/assinatura discreto
export const Signature = () => (
  <Box marginTop={1}>
    <Text color={theme.subtle}>v{APP_VERSION}</Text>
    <Text color={theme.dim}>  made with </Text>
    <Text color={theme.error}>♥</Text>
    <Text color={theme.dim}> devAdminhu</Text>
  </Box>
)
