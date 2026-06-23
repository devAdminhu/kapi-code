import { Box, Text, useInput } from 'ink'
import { theme } from '../theme.js'
import { TOOL_ICON } from '../tools.js'

export type ConfirmRequest = { name: string; preview: string; resolve: (ok: boolean) => void }

const truncate = (s: string, n: number): string => (s.length > n ? `${s.slice(0, n)}…` : s)

export const Confirm = ({ req }: { req: ConfirmRequest }) => {
  useInput((input, key) => {
    const ans = input.toLowerCase()
    if (key.return || ans === 's' || ans === 'y') req.resolve(true)
    else if (ans === 'n' || key.escape) req.resolve(false)
  })

  const icon = TOOL_ICON[req.name] ?? '•'
  return (
    <Box
      borderStyle="round"
      borderColor={theme.warning}
      paddingX={1}
      flexDirection="column"
      marginBottom={1}
    >
      <Box>
        <Text color={theme.warning} bold>
          ⚠ confirmar ação{' '}
        </Text>
        <Text color={theme.tool} bold>
          {icon} {req.name}
        </Text>
      </Box>
      <Box marginTop={1}>
        <Text color={theme.dim}>{truncate(req.preview, 400)}</Text>
      </Box>
      <Box marginTop={1}>
        <Text color={theme.successBright} bold>
          [Enter/s] executar
        </Text>
        <Text color={theme.dim}> · </Text>
        <Text color={theme.errorBright} bold>
          [n/Esc] recusar
        </Text>
      </Box>
    </Box>
  )
}
