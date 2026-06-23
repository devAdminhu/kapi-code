import { Box, Text } from 'ink'
import { execFileSync } from 'node:child_process'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { theme } from '../theme.js'
import { KapiMascot } from './Banner.js'
import { useTermSize } from './useTermSize.js'
import { APP_VERSION, CREDIT_TOTAL } from '../config.js'
import { getLang } from '../i18n.js'



// nome do usuário: git user.name → $USER → 'mano'
const userName = (() => {
  try {
    // execFile (sem shell) — argumentos fixos, nada de input do usuário
    const g = execFileSync('git', ['config', 'user.name'], {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
    if (g) return g
  } catch {
    /* sem git */
  }
  return process.env.USER ?? 'mano'
})()

const shortCwd = (): string => {
  const cwd = process.cwd()
  const home = homedir()
  return cwd.startsWith(home) ? cwd.replace(home, '~') : cwd
}

type Props = { model: string; auto: boolean }

const TIPS = {
  pt: [
    ['Comece com', ' / pra ver os comandos, ou escreva a tarefa direto'],
    ['Modo plano', ' com Shift+Tab — investiga e propõe antes de fazer'],
    ['Multi-agente', ' com /enxame pra objetivos grandes em paralelo'],
  ],
  en: [
    ['Start with', ' / to see commands, or just type your task'],
    ['Plan mode', ' with Shift+Tab — investigates before acting'],
    ['Multi-agent', ' with /enxame for big parallel goals'],
  ],
}

export const Welcome = ({ auto }: Props) => {
  const { cols } = useTermSize()
  const narrow = cols < 78 // sem espaço pras 2 colunas: empilha
  const lang = getLang()
  const tips = TIPS[lang]
  const welcome = lang === 'en' ? 'Welcome back' : 'Bem-vindo de volta'
  const tipsTitle = lang === 'en' ? 'Getting started' : 'Pra começar'

  return (
    <Box
      borderStyle="round"
      borderColor={theme.kapi}
      paddingX={1}
      flexDirection={narrow ? 'column' : 'row'}
      marginBottom={1}
      width={cols}
    >
      {/* coluna esquerda: mascote capivara + identidade */}
      <Box flexDirection="column" width={narrow ? undefined : 40} flexShrink={0}>
        <Box paddingLeft={3} marginBottom={1}>
          <KapiMascot />
        </Box>
        <Text color={theme.subtle}>kapi code</Text>
        <Box marginTop={1}>
          <Text color={theme.accent} bold>
            {welcome} {userName}!
          </Text>
        </Box>
        <Box marginTop={1} flexDirection="column">
          <Text color={theme.subtle}>v{APP_VERSION} · cota Azure ${CREDIT_TOTAL.toFixed(0)}</Text>
          <Text color={theme.subtle}>{shortCwd()}</Text>
        </Box>
      </Box>

      {/* coluna direita: dicas (vira bloco embaixo no modo estreito) */}
      <Box flexDirection="column" flexGrow={1} marginLeft={narrow ? 0 : 2} marginTop={narrow ? 1 : 0}>
        <Text color={theme.kapiShimmer} bold>
          {tipsTitle}
        </Text>
        <Box flexDirection="column" marginTop={1}>
          {tips.map(([head, rest], i) => (
            <Text key={i}>
              <Text color={theme.dim}>• </Text>
              <Text color={theme.text} bold>
                {head}
              </Text>
              <Text color={theme.dim}>{rest}</Text>
            </Text>
          ))}
          {auto && (
            <Text>
              <Text color={theme.warning}>⚡ auto</Text>
              <Text color={theme.dim}> ligado — tools sem confirmar (exceto destrutivos)</Text>
            </Text>
          )}
        </Box>
      </Box>
    </Box>
  )
}
