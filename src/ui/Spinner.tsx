import { useEffect, useState } from 'react'
import { Text } from 'ink'
import { theme } from '../theme.js'
import { nextVerb } from '../verbs.js'
import { getLang } from '../i18n.js'

const fmtTokens = (n: number): string =>
  n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n)

const fmtDur = (s: number): string => (s >= 60 ? `${Math.floor(s / 60)}m ${s % 60}s` : `${s}s`)

// Status estilo Claude Code: ● pulsante + verbo animado +
// (1m 4s · ↑ 4.1k tokens · raciocinando). ↓ = contexto subindo (prefill),
// ↑ = saída sendo gerada. O verbo troca a cada ~2.5s; o relógio a cada 0.5s.
export const Spinner = ({
  label,
  startedAt,
  outTokens = 0,
  inTokens = 0,
  thinking = false,
}: {
  label: string
  startedAt?: number
  outTokens?: number
  inTokens?: number
  thinking?: boolean
}) => {
  const [tick, setTick] = useState(0)
  const [verb, setVerb] = useState(() => nextVerb(getLang()))

  useEffect(() => {
    const clock = setInterval(() => setTick(n => n + 1), 500)
    const word = setInterval(() => setVerb(nextVerb(getLang())), 2500)
    return () => {
      clearInterval(clock)
      clearInterval(word)
    }
  }, [])

  // se o label é um verbo técnico específico (rodando X, compactando), mostra ele;
  // senão usa o verbo animado divertido
  const showVerb = !label || label === 'pensando…' || label === 'thinking…' || label === 'continuando…'
  const secs = startedAt ? Math.max(0, Math.floor((Date.now() - startedAt) / 1000)) : 0
  // gerando saída → ↑; ainda processando o prompt → ↓ (contexto enviado)
  const tok = outTokens > 0 ? `↑ ${fmtTokens(outTokens)}` : `↓ ${fmtTokens(inTokens)}`
  const meta = startedAt
    ? ` (${fmtDur(secs)} · ${tok} tokens${thinking ? ' · raciocinando' : ''})`
    : ''

  return (
    <Text>
      <Text color={tick % 2 === 0 ? theme.kapi : theme.kapiShimmer}>● </Text>
      <Text color={theme.kapi}>{showVerb ? `${verb}…` : label}</Text>
      {meta && <Text color={theme.subtle}>{meta}</Text>}
    </Text>
  )
}
