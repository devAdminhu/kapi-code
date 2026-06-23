// i18n simples: pt e en. As strings da UI passam por t(). O idioma vem das
// settings (/config) e também instrui o modelo a responder no idioma certo.

export type Lang = 'pt' | 'en'

type Dict = Record<string, { pt: string; en: string }>

const DICT: Dict = {
  subtitle: { pt: 'agente de IA no terminal · multi-modelo · Azure', en: 'AI agent in your terminal · multi-model · Azure' },
  placeholder: { pt: 'manda a braba…', en: 'type your message…' },
  thinking: { pt: 'pensando…', en: 'thinking…' },
  continuing: { pt: 'continuando…', en: 'continuing…' },
  compacting: { pt: 'compactando contexto…', en: 'compacting context…' },
  synthesizing: { pt: 'sintetizando…', en: 'synthesizing…' },
  cancelled: { pt: 'cancelado.', en: 'cancelled.' },
  historyCleared: { pt: 'histórico limpo.', en: 'history cleared.' },
  agentMode: { pt: 'agente', en: 'agent' },
  chatMode: { pt: 'chat', en: 'chat' },
  planMode: { pt: 'plano', en: 'plan' },
  // statusline / config
  cfgModel: { pt: 'modelo padrão', en: 'default model' },
  cfgAuto: { pt: 'auto-exec tools', en: 'auto-exec tools' },
  cfgDestructive: { pt: 'liberar destrutivos', en: 'allow destructive' },
  cfgReasoning: { pt: 'raciocínio', en: 'reasoning' },
  cfgLang: { pt: 'idioma', en: 'language' },
  cfgTitle: { pt: 'configuração', en: 'settings' },
  on: { pt: 'ligado', en: 'on' },
  off: { pt: 'desligado', en: 'off' },
  navHelp: { pt: '↑↓ navega · ←→/Enter muda · Esc fecha', en: '↑↓ move · ←→/Enter change · Esc close' },
}

let current: Lang = 'pt'
export const setLang = (l: Lang): void => {
  current = l
}
export const getLang = (): Lang => current

export const t = (key: keyof typeof DICT): string => DICT[key]?.[current] ?? String(key)

/** Instrução de idioma pro system prompt. */
export const langInstruction = (l: Lang): string =>
  l === 'en'
    ? 'Always respond in English.'
    : 'Responda sempre em português do Brasil.'
