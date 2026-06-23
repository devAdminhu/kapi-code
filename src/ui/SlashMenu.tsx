import { Box, Text } from 'ink'
import { theme } from '../theme.js'
import type { SlashCommand } from '../commands.js'

type Props = { items: SlashCommand[]; selected: number }

const MAX_VISIBLE = 8

// Menu de autocomplete que aparece acima do input quando se digita "/".
// Com mais de MAX_VISIBLE itens, vira uma janela rolável centrada no selecionado.
export const SlashMenu = ({ items, selected }: Props) => {
  if (items.length === 0) return null
  // janela deslizante: mantém o item selecionado visível
  const half = Math.floor(MAX_VISIBLE / 2)
  let start = Math.max(0, Math.min(selected - half, items.length - MAX_VISIBLE))
  if (start < 0) start = 0
  const visible = items.slice(start, start + MAX_VISIBLE)
  const above = start
  const below = items.length - (start + visible.length)
  return (
    <Box flexDirection="column" marginBottom={0}>
      {above > 0 && <Text color={theme.subtle}>{`  ↑ +${above}`}</Text>}
      {visible.map((cmd, vi) => {
        const i = start + vi
        const active = i === selected
        return (
          <Box key={cmd.name}>
            <Text color={active ? theme.accent : theme.dim}>{active ? '❯ ' : '  '}</Text>
            <Box width={18} flexShrink={0} marginRight={1}>
              <Text bold color={active ? theme.kapi : theme.text}>
                /{cmd.name}
                {cmd.hint ? <Text color={theme.subtle}> {cmd.hint}</Text> : null}
              </Text>
            </Box>
            <Text color={active ? theme.text : theme.subtle}>{cmd.desc}</Text>
          </Box>
        )
      })}
      {below > 0 && <Text color={theme.subtle}>{`  ↓ +${below}`}</Text>}
    </Box>
  )
}
