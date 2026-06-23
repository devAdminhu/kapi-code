// Paleta própria do Kapi — vibe HUD futurista: ciano elétrico + magenta,
// dark-first. Cores em hex pra alimentar direto o `color`/`borderColor` do Ink.

export const theme = {
  // identidade — ciano elétrico (cor primária) e seu shimmer mais claro
  kapi: '#22d3ee', // ciano elétrico
  kapiShimmer: '#a5f3fc', // ciano claro pro brilho
  accent: '#e879f9', // magenta/lilás de destaque
  fast: '#fb7185', // rosa-coral "fast"

  // semânticas
  success: '#34d399', // esmeralda
  successBright: '#6ee7b7',
  error: '#f43f5e', // rosa-vermelho
  errorBright: '#fb7185',
  warning: '#fbbf24', // âmbar
  spinner: '#818cf8', // índigo do spinner

  // papéis de mensagem
  you: '#38bdf8', // azul-céu pro "você"
  tool: '#c084fc', // roxo pras ferramentas

  // texto
  text: '#e5e7eb',
  dim: '#94a3b8',
  subtle: '#475569',
  border: '#334155',
} as const

export type ThemeColor = keyof typeof theme
