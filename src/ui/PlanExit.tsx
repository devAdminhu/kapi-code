import { Box, Text, useInput } from 'ink'
import { theme } from '../theme.js'

export type PlanExitChoice = 'keep' | 'fresh' | 'cancel'

// Diálogo ao sair do plan mode: continuar com contexto cheio, limpar e seguir
// só com o plano, ou cancelar (volta pro plano).
export const PlanExit = ({ onChoice }: { onChoice: (c: PlanExitChoice) => void }) => {
  useInput((input, key) => {
    const a = input.toLowerCase()
    if (a === '1' || key.return) onChoice('keep')
    else if (a === '2') onChoice('fresh')
    else if (a === '3' || key.escape) onChoice('cancel')
  })

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={theme.kapi}
      paddingX={1}
      marginBottom={1}
    >
      <Text bold color={theme.kapi}>
        📋 sair do modo plano — como continuar?
      </Text>
      <Box marginTop={1} flexDirection="column">
        <Text>
          <Text color={theme.successBright} bold>
            [1/Enter]
          </Text>
          <Text color={theme.text}> construir mantendo todo o contexto</Text>
        </Text>
        <Text>
          <Text color={theme.accent} bold>
            [2]
          </Text>
          <Text color={theme.text}> limpar tudo e construir só com o plano (janela nova)</Text>
        </Text>
        <Text>
          <Text color={theme.dim} bold>
            [3/Esc]
          </Text>
          <Text color={theme.dim}> cancelar (continuar planejando)</Text>
        </Text>
      </Box>
    </Box>
  )
}
