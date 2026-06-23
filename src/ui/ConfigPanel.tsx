import { useState } from 'react'
import { Box, Text, useInput } from 'ink'
import { theme } from '../theme.js'
import { MODELS } from '../models.js'
import type { Settings } from '../settings.js'

type Props = {
  settings: Settings
  onChange: (s: Settings) => void
  onClose: () => void
}

type Field = 'defaultModel' | 'auto' | 'allowDestructive' | 'reasoning' | 'lang'
const FIELDS: Field[] = ['defaultModel', 'auto', 'allowDestructive', 'reasoning', 'lang']
const ALIASES = MODELS.map(m => m.alias)
const REASONING: Settings['reasoning'][] = ['short', 'full', 'hidden']
const REASONING_LABEL = { short: 'resumido', full: 'completo', hidden: 'escondido' }
const LANGS: Settings['lang'][] = ['pt', 'en']
const LANG_LABEL = { pt: 'português', en: 'english' }

// Menu de configuração estilo Claude Code: navega ↑↓, ← → muda o valor.
export const ConfigPanel = ({ settings, onChange, onClose }: Props) => {
  const [sel, setSel] = useState(0)
  const [s, setS] = useState<Settings>(settings)

  const commit = (next: Settings): void => {
    setS(next)
    onChange(next)
  }

  const cycle = (dir: 1 | -1): void => {
    const field = FIELDS[sel]
    if (field === 'defaultModel') {
      const i = ALIASES.indexOf(s.defaultModel)
      const next = ALIASES[(i + dir + ALIASES.length) % ALIASES.length]!
      commit({ ...s, defaultModel: next })
    } else if (field === 'auto') {
      commit({ ...s, auto: !s.auto })
    } else if (field === 'allowDestructive') {
      commit({ ...s, allowDestructive: !s.allowDestructive })
    } else if (field === 'reasoning') {
      const i = REASONING.indexOf(s.reasoning)
      commit({ ...s, reasoning: REASONING[(i + dir + REASONING.length) % REASONING.length]! })
    } else if (field === 'lang') {
      const i = LANGS.indexOf(s.lang)
      commit({ ...s, lang: LANGS[(i + dir + LANGS.length) % LANGS.length]! })
    }
  }

  useInput((_input, key) => {
    if (key.escape || _input === 'q') return onClose()
    if (key.upArrow) setSel(v => (v - 1 + FIELDS.length) % FIELDS.length)
    else if (key.downArrow) setSel(v => (v + 1) % FIELDS.length)
    else if (key.leftArrow) cycle(-1)
    else if (key.rightArrow || key.return || _input === ' ') cycle(1)
  })

  const row = (field: Field, label: string, value: string, warn = false) => {
    const active = FIELDS[sel] === field
    return (
      <Box>
        <Text color={active ? theme.accent : theme.dim}>{active ? '❯ ' : '  '}</Text>
        <Box width={22}>
          <Text bold color={active ? theme.kapi : theme.text}>
            {label}
          </Text>
        </Box>
        <Text color={warn ? theme.warning : active ? theme.accent : theme.successBright}>{value}</Text>
      </Box>
    )
  }

  return (
    <Box flexDirection="column" borderStyle="round" borderColor={theme.kapi} paddingX={1} marginBottom={1}>
      <Text bold color={theme.kapi}>
        ⚙ configuração
      </Text>
      <Box flexDirection="column" marginTop={1}>
        {row('defaultModel', 'modelo padrão', s.defaultModel)}
        {row('auto', 'auto-exec tools', s.auto ? 'ligado' : 'desligado', s.auto)}
        {row(
          'allowDestructive',
          'liberar destrutivos',
          s.allowDestructive ? 'SIM (perigoso!)' : 'não (confirma)',
          s.allowDestructive,
        )}
        {row('reasoning', 'raciocínio', REASONING_LABEL[s.reasoning])}
        {row('lang', 'idioma / language', LANG_LABEL[s.lang])}
      </Box>
      <Box marginTop={1}>
        <Text color={theme.subtle}>↑↓ navega · ←→/Enter muda · Esc fecha</Text>
      </Box>
    </Box>
  )
}
