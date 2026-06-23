// Catálogo dos slash commands — alimenta o autocomplete e é a fonte única.
export type SlashCommand = {
  name: string // sem a barra
  desc: string
  hint?: string // argumento esperado, ex: "<modelo>"
}

export const COMMANDS: SlashCommand[] = [
  { name: 'model', desc: 'troca de modelo (sem arg abre o painel)', hint: '<modelo>' },
  { name: 'login', desc: 'conecta um provider (API key ou OAuth)' },
  { name: 'config', desc: 'menu de configuração (modelo, auto, destrutivos, raciocínio)' },
  { name: 'gasto', desc: 'painel de custo acumulado + cota Azure' },
  { name: 'agente', desc: 'alterna entre modo agente e chat puro' },
  { name: 'auto', desc: 'liga/desliga execução de tools sem confirmar' },
  { name: 'system', desc: 'redefine o system prompt e limpa o histórico', hint: '<texto>' },
  { name: 'compact', desc: 'resume o histórico pra liberar contexto (auto quando enche)' },
  { name: 'reasoning', desc: 'alterna raciocínio: resumido → completo → escondido (Ctrl+R)' },
  { name: 'enxame', desc: 'lança vários subagentes em paralelo num objetivo grande', hint: '<objetivo>' },
  { name: 'plano', desc: 'modo plano: só investiga e propõe plano, sem alterar (Shift+Tab)' },
  { name: 'lembrar', desc: 'salva um fato na memória persistente', hint: '<fato>' },
  { name: 'reset', desc: 'limpa o histórico da sessão' },
  { name: 'sair', desc: 'sai do Kapi' },
]

/** Filtra comandos pelo texto digitado depois da barra (prefix match + fuzzy). */
export const filterCommands = (query: string): SlashCommand[] => {
  const q = query.toLowerCase()
  if (!q) return COMMANDS
  const starts = COMMANDS.filter(c => c.name.startsWith(q))
  const includes = COMMANDS.filter(c => !c.name.startsWith(q) && c.name.includes(q))
  return [...starts, ...includes]
}
