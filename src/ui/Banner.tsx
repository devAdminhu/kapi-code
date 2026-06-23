import { useEffect, useState } from 'react'
import { Box, Text } from 'ink'
import figlet from 'figlet'
import { theme } from '../theme.js'
import { aliasOf, infoOf, providerIdOf } from '../models.js'
import { useTermSize } from './useTermSize.js'
import { APP_VERSION } from '../config.js'

// interpola entre verde bandeira e ouro pro shimmer
const hexToRgb = (h: string): [number, number, number] => {
  const n = parseInt(h.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}
const lerp = (a: number, b: number, t: number): number => Math.round(a + (b - a) * t)
const A = hexToRgb(theme.kapi)
const B = hexToRgb(theme.kapiShimmer)
const mix = (t: number): string => {
  const r = lerp(A[0], B[0], t)
  const g = lerp(A[1], B[1], t)
  const b = lerp(A[2], B[2], t)
  return `rgb(${r},${g},${b})`
}

// logo gerado pela lib figlet (fonte Small, compacta e legível), com fallback
const LOGO: string[] = (() => {
  try {
    return figlet
      .textSync('KAPI', { font: 'Small' })
      .split('\n')
      .filter(l => l.length > 0)
  } catch {
    return [
      '  _  __   _   ___ ___ ',
      ' | |/ /  /_\\ | _ \\_ _|',
      " | ' <  / _ \\|  _/| | ",
      ' |_|\\_\\/_/ \\_\\_| |___|',
    ]
  }
})()

export const KAPI_LOGO = LOGO

// ── mascote: rostinho de capivara em pixel-art ──
// half-blocks: cada célula do terminal vira 2 pixels verticais (▀ = pixel de
// cima na cor do texto, pixel de baixo na cor do fundo), igual o mascote do
// Claude Code. Grade: '.' transparente; letras = cores do MASCOT_COLORS.
const MASCOT_COLORS: Record<string, string> = {
  C: '#c08a5a', // pelo marrom capivara
  D: '#8a5a36', // orelhas/sombra
  N: '#9c6b40', // focinho
  E: '#241a12', // olhos e narinas
}

const MASCOT: string[] = [
  '.DD..........DD.',
  '.CCCCCCCCCCCCCC.',
  'CCCCCCCCCCCCCCCC',
  'CCEECCCCCCCCEECC',
  'CCCCCCCCCCCCCCCC',
  'CCCCNNNNNNNNCCCC',
  'CCCNENNNNNNENCCC',
  'CCCNNNNNNNNNNCCC',
  '.CCCNNNNNNNNCCC.',
  '..CCCCCCCCCCCC..',
]

const pixelColor = (row: string | undefined, i: number): string | null =>
  MASCOT_COLORS[row?.[i] ?? '.'] ?? null

/** Rostinho da capivara (mascote do Kapi), estático. */
export const KapiMascot = () => (
  <Box flexDirection="column">
    {Array.from({ length: Math.ceil(MASCOT.length / 2) }, (_, r) => {
      const top = MASCOT[r * 2]
      const bottom = MASCOT[r * 2 + 1]
      const width = Math.max(top?.length ?? 0, bottom?.length ?? 0)
      return (
        <Text key={r}>
          {Array.from({ length: width }, (_, i) => {
            const tc = pixelColor(top, i)
            const bc = pixelColor(bottom, i)
            if (tc && bc) return (
              <Text key={i} color={tc} backgroundColor={bc}>▀</Text>
            )
            if (tc) return <Text key={i} color={tc}>▀</Text>
            if (bc) return <Text key={i} color={bc}>▄</Text>
            return <Text key={i}> </Text>
          })}
        </Text>
      )
    })}
  </Box>
)

/** Cada coluna recebe uma fase do shimmer que desliza com o tempo. */
export const ShimmerLine = ({ line, phase }: { line: string; phase: number }) => {
  const chars = [...line]
  return (
    <Text>
      {chars.map((ch, i) => {
        if (ch === ' ') return <Text key={i}> </Text>
        const t = (Math.sin((i / 5 + phase) * 0.6) + 1) / 2
        return (
          <Text key={i} color={mix(t)} bold>
            {ch}
          </Text>
        )
      })}
    </Text>
  )
}

// hook do shimmer: anima ~5s no boot e congela (não pode rodar pra sempre no Static)
const useShimmer = (): number => {
  const [phase, setPhase] = useState(0)
  useEffect(() => {
    let n = 0
    const t = setInterval(() => {
      n += 1
      setPhase(p => p + 0.4)
      if (n > 45) clearInterval(t)
    }, 120)
    return () => clearInterval(t)
  }, [])
  return phase
}

/** Logo KAPI animado, reutilizável (usado no card de boas-vindas). */
export const KapiLogo = () => {
  const phase = useShimmer()
  return (
    <Box flexDirection="column">
      {LOGO.map((line, i) => (
        <ShimmerLine key={i} line={line} phase={phase + i * 0.7} />
      ))}
    </Box>
  )
}

// Banner standalone (caso usado fora do card)
export const Banner = () => {
  const phase = useShimmer()

  return (
    <Box flexDirection="row" marginBottom={1}>
      <Box flexDirection="column">
        {LOGO.map((line, i) => (
          <ShimmerLine key={i} line={line} phase={phase + i * 0.7} />
        ))}
      </Box>
      <Box marginLeft={2} alignItems="flex-end">
        <Text color={theme.subtle}>agente de IA no terminal · multi-modelo · Azure</Text>
      </Box>
    </Box>
  )
}

type StatusProps = {
  model: string
  agentMode: boolean
  auto: boolean
  planMode?: boolean
  usedUsd: number
  creditTotal: number
  ctxTokens: number
  ctxLimit: number
}

const fmtTokens = (n: number): string => {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1000) return `${(n / 1000).toFixed(0)}k`
  return String(n)
}

// Barra única embaixo, estilo Claude Code: chip + modelo · contexto% · custo% · modo.
export const StatusLine = ({
  model,
  agentMode,
  auto,
  planMode,
  usedUsd,
  creditTotal,
  ctxTokens,
  ctxLimit,
}: StatusProps) => {
  const { cols } = useTermSize()
  const info = infoOf(model)
  const ctxPct = ctxLimit > 0 ? Math.min(100, Math.round((ctxTokens / ctxLimit) * 100)) : 0
  const costPct = Math.round((usedUsd / creditTotal) * 100)
  const sep = <Text color={theme.subtle}>  </Text>
  const ctxColor = ctxPct > 85 ? theme.error : ctxPct > 60 ? theme.warning : theme.dim
  // responsivo: vai escondendo o menos importante conforme aperta
  const showDeployment = cols >= 100
  const showSignature = cols >= 80
  const showTokensAbs = cols >= 65

  return (
    <Box justifyContent="space-between">
      <Box>
        {/* chip do "projeto" */}
        <Text backgroundColor={theme.kapi} color="#0a0a0a" bold>
          {' '}
          kapi{' '}
        </Text>
        {sep}
        <Text color={theme.kapi}>✦ </Text>
        <Text bold color={theme.accent}>
          {aliasOf(model)}
        </Text>
        {providerIdOf(model) !== 'azure' && (
          <Text color={theme.tool}> {providerIdOf(model)}</Text>
        )}
        {info && showDeployment && <Text color={theme.subtle}> {info.deployment}</Text>}
        {sep}
        {/* contexto usado */}
        <Text color={theme.dim}>◔ </Text>
        {showTokensAbs && (
          <Text color={ctxColor}>
            {fmtTokens(ctxTokens)}/{fmtTokens(ctxLimit)}{' '}
          </Text>
        )}
        <Text color={ctxColor}>({ctxPct}%)</Text>
        {sep}
        {/* custo + % da cota */}
        <Text color={theme.dim}>⊙ </Text>
        <Text color={theme.successBright}>${usedUsd.toFixed(4)}</Text>
        <Text color={theme.dim}> {costPct}%</Text>
        {sep}
        {/* modo */}
        {planMode ? (
          <Text color={theme.accent} bold>📋 plano</Text>
        ) : (
          <Text color={agentMode ? theme.kapi : theme.you}>{agentMode ? '⚙ agente' : '💬 chat'}</Text>
        )}
        {auto && !planMode && <Text color={theme.warning}> ⚡auto</Text>}
      </Box>
      {/* assinatura na ponta direita da mesma linha */}
      {showSignature && (
        <Box>
          <Text color={theme.subtle}>v{APP_VERSION} </Text>
          <Text color={theme.error}>♥</Text>
        </Box>
      )}
    </Box>
  )
}
