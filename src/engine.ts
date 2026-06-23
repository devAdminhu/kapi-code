import { streamChat } from './api/client.js'
import type { ChatMessage, ImagePart } from './api/types.js'
import { aliasOf, estimateTokens } from './models.js'
import { ctxLimit } from './ctxwindow.js'
import { buildSystemPrompt } from './context.js'
import { registerUsage } from './spend.js'
import { SYSTEM_AGENT, SYSTEM_CHAT, PLAN_MODE_INSTRUCTION, PLAN_MODE_TOOLS } from './prompts.js'
import { DANGEROUS, isDestructive, parseToolArgs, runToolFull, TOOLS, toolPreview } from './tools.js'
import type { DiffLine } from './diff.js'
import { langInstruction } from './i18n.js'
import { saveSession, loadSession } from './session.js'
import { BASE_COMPACT_PROMPT, NO_TOOLS_PREAMBLE, getCompactSummaryMessage } from './compactPrompt.js'
import { runSwarm, synthesize, type SubAgentSpec, type SubAgentTipo } from './swarm.js'

// margem que o Claude Code deixa antes de auto-compactar (janela − buffer)
const AUTOCOMPACT_BUFFER = 13_000

// ── itens que a UI renderiza no histórico ──
export type ChatItem =
  | { kind: 'user'; text: string; images?: ImagePart[] }
  | { kind: 'assistant'; model: string; text: string; reasoning?: string; cost?: number }
  | { kind: 'tool'; name: string; preview: string; result: string; refused?: boolean; diff?: DiffLine[] }
  | { kind: 'system'; text: string; tone?: 'info' | 'error' | 'warn' }
  | { kind: 'swarm'; objetivo: string; agentes: { tarefa: string; tipo: string; modelo: string; ok: boolean }[] }

export type ConfirmFn = (name: string, preview: string) => Promise<boolean>

export type EngineEvents = {
  // um item finalizado entra no histórico
  pushItem: (item: ChatItem) => void
  // streaming da resposta atual (texto parcial); null = limpa o buffer ativo
  onAssistantDelta: (model: string, partial: string, reasoning: string) => void
  onStatus: (status: string | null) => void
  onSpendChange: () => void
  confirm: ConfirmFn
}

export class Engine {
  private history: ChatMessage[]
  private lastPromptTokens = 0 // prompt_tokens reais da última chamada
  private lastBoundaryLen = 0 // tamanho do histórico no momento dessa chamada
  turnOutTokens = 0 // tokens de saída REAIS acumulados no turno atual (pro status)
  agentMode: boolean
  auto: boolean
  allowDestructive = false // liberado via /config
  planMode = false // só investiga e propõe plano, não altera
  lang: 'pt' | 'en' = 'pt'
  model: string

  constructor(model: string, agentMode: boolean, auto: boolean) {
    this.model = model
    this.agentMode = agentMode
    this.auto = auto
    this.history = [{ role: 'system', content: this.baseSystem() }]
  }

  // system prompt base (agente/chat) + KAPI.md/AGENTS.md + memória persistente
  // (+ instrução de plan mode quando ativo)
  private baseSystem(): string {
    const base = this.agentMode ? SYSTEM_AGENT : SYSTEM_CHAT
    let full = this.planMode ? `${base}\n\n${PLAN_MODE_INSTRUCTION}` : base
    full = `${full}\n\n${langInstruction(this.lang)}`
    return buildSystemPrompt(full)
  }

  /** Liga/desliga o plan mode e reconstrói o system. */
  setPlanMode(on: boolean): void {
    this.planMode = on
    this.reloadContext()
  }

  /** Última resposta do assistant (o plano proposto), se houver. */
  lastAssistantText(): string {
    for (let i = this.history.length - 1; i >= 0; i--) {
      const m = this.history[i]
      if (m?.role === 'assistant' && typeof m.content === 'string' && m.content.trim()) return m.content
    }
    return ''
  }

  /** Salva o histórico atual em disco pra retomar com `kapi -c`. */
  saveSession(items: ChatItem[]): void {
    saveSession(this.history, items)
  }

  /** Restaura o histórico de uma sessão salva. Retorna os itens pra UI. */
  restoreSession(): ChatItem[] | null {
    const saved = loadSession()
    if (!saved) return null
    // preserva o system atual (com KAPI.md/memória frescos), reusa o resto
    const sys = this.history[0]
    this.history = sys ? [sys, ...saved.history.filter(m => m.role !== 'system')] : saved.history
    this.lastPromptTokens = 0
    this.lastBoundaryLen = 0
    return saved.items
  }

  /**
   * Sai do plan mode aplicando o plano: limpa o histórico e recomeça uma janela
   * nova já com o plano aprovado como contexto, pronto pra construir.
   */
  applyPlanFresh(plan: string): void {
    this.planMode = false
    // baseSystem() preserva instrução de idioma + KAPI.md/memória
    this.history = [
      { role: 'system', content: this.baseSystem() },
      {
        role: 'assistant',
        content: `Plano aprovado. Vou executá-lo agora:\n\n${plan}`,
      },
    ]
    this.lastPromptTokens = 0
    this.lastBoundaryLen = 0
  }

  /** Recarrega instruções/memória do disco e reconstrói o system (mantém histórico). */
  reloadContext(): void {
    if (this.history[0]?.role === 'system') {
      this.history[0] = { role: 'system', content: this.baseSystem() }
    }
  }

  reset(): void {
    const sys = this.history[0]
    this.history = sys ? [sys] : [{ role: 'system', content: SYSTEM_CHAT }]
    this.lastPromptTokens = 0
    this.lastBoundaryLen = 0
  }

  setSystem(text: string): void {
    this.history = [{ role: 'system', content: text }]
    this.lastPromptTokens = 0
    this.lastBoundaryLen = 0
  }

  setMode(agentMode: boolean): void {
    this.agentMode = agentMode
    if (this.history[0]?.role === 'system') {
      this.history[0] = { role: 'system', content: this.baseSystem() }
    }
  }

  // grava o prompt_tokens real + o tamanho do histórico naquele instante
  private recordContext(promptTokens: number): void {
    if (promptTokens > 0) {
      this.lastPromptTokens = promptTokens
      this.lastBoundaryLen = this.history.length
    }
  }

  /**
   * Tokens do contexto atual. Usa o prompt_tokens REAL da última chamada (exato
   * pro que já foi enviado) e soma a estimativa das mensagens adicionadas depois.
   */
  contextTokens(): number {
    if (this.lastPromptTokens > 0) {
      let extra = 0
      for (let i = this.history.length - 1; i >= this.lastBoundaryLen; i--) {
        const m = this.history[i]
        if (m) extra += estimateTokens(typeof m.content === 'string' ? m.content : '')
      }
      return this.lastPromptTokens + extra
    }
    return this.history.reduce(
      (sum, m) => sum + estimateTokens(typeof m.content === 'string' ? m.content : ''),
      0,
    )
  }

  /** Fração do contexto usada (0..1) pro modelo atual. */
  contextUsage(): number {
    const limit = ctxLimit(this.model)
    return limit > 0 ? this.contextTokens() / limit : 0
  }

  /**
   * Limiar de auto-compact, no padrão Claude Code: janela efetiva − buffer fixo
   * (AUTOCOMPACT_BUFFER). Garante sempre folga pra resposta, em vez de % fixo.
   */
  private autoCompactThreshold(): number {
    return Math.max(0, ctxLimit(this.model) - AUTOCOMPACT_BUFFER)
  }

  /** Se já passou do limiar e vale a pena compactar (precisa ter histórico). */
  shouldAutoCompact(): boolean {
    return this.contextTokens() >= this.autoCompactThreshold() && this.history.length > 3
  }

  /**
   * Microcompact (estilo Claude Code): antes do compact total, esvazia o conteúdo
   * de tool_results ANTIGOS — que são o que mais incham — preservando os recentes.
   * Roda quando o contexto passa de ~70% da janela. Retorna tokens liberados.
   */
  microCompact(keepRecent = 6): number {
    const limit = ctxLimit(this.model)
    if (limit <= 0 || this.contextTokens() < limit * 0.7) return 0
    // índices das mensagens tool, da mais antiga pra mais nova
    const toolIdx = this.history
      .map((m, i) => (m.role === 'tool' ? i : -1))
      .filter(i => i >= 0)
    const toClear = toolIdx.slice(0, Math.max(0, toolIdx.length - keepRecent))
    let freed = 0
    for (const i of toClear) {
      const m = this.history[i]
      if (m && m.role === 'tool' && m.content !== '[resultado antigo removido]') {
        freed += estimateTokens(m.content)
        m.content = '[resultado antigo removido]'
      }
    }
    if (freed > 0) {
      this.lastPromptTokens = 0 // força recontagem real na próxima chamada
      this.lastBoundaryLen = 0
    }
    return freed
  }

  /**
   * Compacta o histórico no padrão Claude Code: pede um resumo estruturado de 9
   * seções (com scratchpad <analysis> + <summary>) e substitui o histórico por
   * uma mensagem de "sessão continuada". Retorna tokens antes→depois ou null.
   */
  async compact(ev: EngineEvents, signal: AbortSignal): Promise<{ before: number; after: number } | null> {
    const sys = this.history[0]
    const convo = this.history.slice(1)
    if (convo.length < 2) return null

    const before = this.contextTokens()
    ev.onStatus('compactando contexto…')

    // a conversa inteira vira o contexto; o prompt pede o resumo estruturado
    const summaryPrompt: ChatMessage[] = [
      ...this.history,
      { role: 'user', content: NO_TOOLS_PREAMBLE + BASE_COMPACT_PROMPT },
    ]

    try {
      const res = await streamChat(this.model, summaryPrompt, { temperature: 0.2, maxTokens: 4096, signal })
      registerUsage(this.model, res.usage.in, res.usage.out)
      ev.onSpendChange()
      if (!res.content.trim()) {
        ev.onStatus(null)
        return null
      }
      const summaryMsg = getCompactSummaryMessage(res.content)
      this.history = [
        sys ?? { role: 'system', content: SYSTEM_CHAT },
        { role: 'assistant', content: summaryMsg },
      ]
      this.lastPromptTokens = 0
      this.lastBoundaryLen = 0
      const after = this.contextTokens()
      ev.onStatus(null)
      return { before, after }
    } catch (e) {
      ev.onStatus(null)
      if (!signal.aborted) ev.pushItem({ kind: 'system', tone: 'error', text: `compact falhou: ${errMsg(e)}` })
      return null
    }
  }

  /**
   * Enxame via comando /enxame: roda o fan-out e mostra a síntese como resposta.
   */
  async swarm(objetivo: string, ev: EngineEvents, signal: AbortSignal): Promise<void> {
    ev.pushItem({ kind: 'user', text: `/enxame ${objetivo}` })
    const sintese = await this.runSwarmInline(objetivo, ev, signal)
    if (sintese && !sintese.startsWith('[')) {
      this.history.push({ role: 'user', content: `[enxame] ${objetivo}` })
      this.history.push({ role: 'assistant', content: sintese })
    }
  }

  /**
   * Núcleo do enxame: decompõe o objetivo, dispara subagentes em paralelo,
   * coleta e sintetiza. Retorna a síntese (texto) — usada pelo comando e pela
   * tool 'enxame'. Mostra progresso e a síntese (streaming) na UI.
   */
  async runSwarmInline(objetivo: string, ev: EngineEvents, signal: AbortSignal): Promise<string> {
    ev.onStatus('decompondo objetivo…')

    // 1) o modelo quebra o objetivo em sub-tarefas independentes, cada uma com
    //    seu TIPO de subagente (explorador/planejador/executor)
    let specs: SubAgentSpec[]
    try {
      const planMsg: ChatMessage[] = [
        {
          role: 'system',
          content:
            'Quebre o objetivo do usuário em 2 a 5 sub-tarefas INDEPENDENTES que rodem em paralelo, ' +
            'cada uma resolvível por um subagente sozinho. Para cada uma, escolha o tipo de agente: ' +
            '"explorador" (investiga/lê/pesquisa), "planejador" (arquiteta/projeta) ou "executor" ' +
            '(faz/resolve). Responda APENAS um JSON array de objetos {"tarefa","tipo"}, sem texto extra. ' +
            'Ex: [{"tarefa":"pesquisar X","tipo":"explorador"},{"tarefa":"implementar Y","tipo":"executor"}].',
        },
        { role: 'user', content: objetivo },
      ]
      const plan = await streamChat(this.model, planMsg, { temperature: 0.3, maxTokens: 700, signal })
      registerUsage(this.model, plan.usage.in, plan.usage.out)
      this.turnOutTokens += plan.usage.out
      ev.onSpendChange()
      const match = plan.content.match(/\[[\s\S]*\]/)
      const arr = match ? (JSON.parse(match[0]) as unknown[]) : []
      const validTipos = new Set<SubAgentTipo>(['explorador', 'planejador', 'executor'])
      specs = arr
        .map((raw): SubAgentSpec | null => {
          if (typeof raw === 'string') return { tarefa: raw, tipo: 'executor' }
          const o = raw as { tarefa?: unknown; tipo?: unknown }
          if (typeof o.tarefa !== 'string' || !o.tarefa) return null
          const tipo: SubAgentTipo = validTipos.has(o.tipo as SubAgentTipo) ? (o.tipo as SubAgentTipo) : 'executor'
          return { tarefa: o.tarefa, tipo }
        })
        .filter((s): s is SubAgentSpec => s !== null)
    } catch {
      specs = []
    }
    if (!specs.length) {
      ev.onStatus(null)
      ev.pushItem({ kind: 'system', tone: 'error', text: 'não consegui decompor o objetivo em sub-tarefas' })
      return '[enxame não conseguiu decompor o objetivo]'
    }

    // 2) fan-out
    const done: { tarefa: string; tipo: string; modelo: string; ok: boolean }[] = specs.map(s => ({
      tarefa: s.tarefa,
      tipo: s.tipo ?? 'executor',
      modelo: this.model,
      ok: false,
    }))
    ev.onStatus(`enxame: ${specs.length} subagentes…`)
    const results = await runSwarm(specs, this.model, {
      onStart: () => {},
      onAgentDone: (i, r) => {
        const d = done[i]
        if (d) {
          d.ok = !r.erro
          d.modelo = r.modelo
        }
        ev.onStatus(`enxame: ${done.filter(x => x.ok).length}/${specs.length} prontos…`)
      },
      onSpendChange: ev.onSpendChange,
    }, signal)
    ev.pushItem({ kind: 'swarm', objetivo, agentes: done })

    // 3) síntese final (com streaming na UI)
    ev.onStatus('sintetizando…')
    let live = ''
    try {
      const { texto, usageIn, usageOut } = await synthesize(objetivo, results, this.model, signal, d => {
        live += d
        ev.onAssistantDelta(this.model, live, '')
      })
      const { cost } = registerUsage(this.model, usageIn, usageOut)
      this.turnOutTokens += usageOut
      ev.onSpendChange()
      ev.onAssistantDelta(this.model, '', '')
      ev.onStatus(null)
      ev.pushItem({ kind: 'assistant', model: this.model, text: texto, cost })
      return texto
    } catch (e) {
      ev.onStatus(null)
      ev.onAssistantDelta(this.model, '', '')
      if (!signal.aborted) ev.pushItem({ kind: 'system', tone: 'error', text: `síntese falhou: ${errMsg(e)}` })
      return '[síntese do enxame falhou]'
    }
  }

  /** Processa uma mensagem do usuário de ponta a ponta. */
  async send(userText: string, ev: EngineEvents, signal: AbortSignal, images?: ImagePart[], skipUserPush = false): Promise<void> {
    // microcompact: limpa tool_results antigos ao passar de ~70% (barato, antes do total)
    const freed = this.microCompact()
    if (freed > 1000) {
      ev.pushItem({ kind: 'system', text: `🧹 microcompact: ~${freed.toLocaleString('pt-BR')} tokens liberados` })
    }
    // auto-compact (padrão Claude): falta menos que o buffer pra estourar → resume
    if (this.shouldAutoCompact()) {
      ev.pushItem({ kind: 'system', tone: 'warn', text: 'contexto quase cheio — compactando automaticamente…' })
      const r = await this.compact(ev, signal)
      if (r) {
        ev.pushItem({
          kind: 'system',
          text: `compactado: ${r.before.toLocaleString('pt-BR')} → ${r.after.toLocaleString('pt-BR')} tokens`,
        })
      }
    }
    // se veio da fila, a linha do usuário já foi mostrada — só registra no histórico
    if (!skipUserPush) ev.pushItem({ kind: 'user', text: userText, images })
    this.history.push({ role: 'user', content: userText, images: images?.length ? images : undefined })
    this.turnOutTokens = 0
    if (this.agentMode) await this.agentLoop(ev, signal)
    else await this.chatTurn(ev, signal)
  }

  private async chatTurn(ev: EngineEvents, signal: AbortSignal): Promise<void> {
    ev.onStatus('pensando…')
    let live = ''
    let reasoning = ''
    try {
      const res = await streamChat(this.model, this.history, {
        temperature: 0.6,
        signal,
        callbacks: {
          onText: d => {
            live += d
            ev.onAssistantDelta(this.model, live, reasoning)
          },
          onReasoning: d => {
            reasoning += d
            ev.onAssistantDelta(this.model, live, reasoning)
          },
        },
      })
      ev.onStatus(null)
      ev.onAssistantDelta(this.model, '', '')
      this.recordContext(res.usage.in)
      const { cost } = registerUsage(this.model, res.usage.in, res.usage.out)
      this.turnOutTokens += res.usage.out
      ev.onSpendChange()
      this.history.push({ role: 'assistant', content: res.content })
      ev.pushItem({
        kind: 'assistant',
        model: this.model,
        text: res.content,
        reasoning: res.reasoning || undefined,
        cost,
      })
      if (res.finishReason === 'length') {
        ev.pushItem({ kind: 'system', tone: 'warn', text: '⚠️ resposta cortada no limite de tokens de saída' })
      }
    } catch (e) {
      ev.onStatus(null)
      ev.onAssistantDelta(this.model, '', '')
      if (signal.aborted) return
      ev.pushItem({ kind: 'system', tone: 'error', text: errMsg(e) })
    }
  }

  private async agentLoop(ev: EngineEvents, signal: AbortSignal, maxSteps = 24): Promise<void> {
    for (let step = 0; step < maxSteps; step++) {
      ev.onStatus(step === 0 ? 'pensando…' : 'continuando…')
      let live = ''
      let reasoning = ''
      let res
      try {
        res = await streamChat(this.model, this.history, {
          // plan mode: só ferramentas de leitura/pesquisa
          tools: this.planMode ? TOOLS.filter(t => PLAN_MODE_TOOLS.has(t.function.name)) : TOOLS,
          temperature: 0.4,
          signal,
          callbacks: {
            onText: d => {
              live += d
              ev.onAssistantDelta(this.model, live, reasoning)
            },
            onReasoning: d => {
              reasoning += d
              ev.onAssistantDelta(this.model, live, reasoning)
            },
          },
        })
      } catch (e) {
        ev.onStatus(null)
        ev.onAssistantDelta(this.model, '', '')
        if (signal.aborted) return
        ev.pushItem({ kind: 'system', tone: 'error', text: errMsg(e) })
        return
      }
      ev.onAssistantDelta(this.model, '', '')
      this.recordContext(res.usage.in)
      const { cost } = registerUsage(this.model, res.usage.in, res.usage.out)
      this.turnOutTokens += res.usage.out
      ev.onSpendChange()

      this.history.push({
        role: 'assistant',
        content: res.content || null,
        tool_calls: res.toolCalls.length ? res.toolCalls : undefined,
      })

      if (!res.toolCalls.length) {
        ev.onStatus(null)
        ev.pushItem({
          kind: 'assistant',
          model: this.model,
          text: res.content,
          reasoning: res.reasoning || undefined,
          cost,
        })
        return
      }

      // tem texto intermediário antes das tools? mostra
      if (res.content.trim()) {
        ev.pushItem({ kind: 'assistant', model: this.model, text: res.content, cost })
      }

      if (res.finishReason === 'length') {
        ev.pushItem({ kind: 'system', tone: 'warn', text: '⚠️ resposta cortada no limite de tokens de saída' })
      }

      for (const call of res.toolCalls) {
        // cancelado no meio: ainda responde cada tool_call pendente, senão o
        // histórico fica órfão e a próxima chamada à API falha com 400
        if (signal.aborted) {
          this.history.push({ role: 'tool', tool_call_id: call.id, content: '[cancelado pelo usuário]' })
          continue
        }
        const name = call.function.name
        const args = parseToolArgs(call.function.arguments)
        const preview = toolPreview(name, args)

        // destrutivo SEMPRE confirma (mesmo em auto), salvo liberado no /config.
        // não-destrutivo perigoso confirma só fora do auto.
        const destrutivo = isDestructive(name, args) && !this.allowDestructive
        const needsConfirm = destrutivo || (DANGEROUS.has(name) && !this.auto)
        if (needsConfirm) {
          ev.onStatus(null)
          const label = destrutivo ? `${name} ⚠️ DESTRUTIVO` : name
          const ok = await ev.confirm(label, preview)
          if (!ok) {
            ev.pushItem({ kind: 'tool', name, preview, result: '[recusado pelo usuário]', refused: true })
            this.history.push({ role: 'tool', tool_call_id: call.id, content: '[recusado pelo usuário]' })
            continue
          }
        }

        // enxame é interceptado: roda o sistema multi-agente interno (com UI),
        // não vai pro runTool. O resultado da síntese volta como tool result.
        if (name === 'enxame') {
          const objetivo = String(args.objetivo ?? '')
          const sintese = await this.runSwarmInline(objetivo, ev, signal)
          this.history.push({ role: 'tool', tool_call_id: call.id, content: sintese })
          continue
        }

        ev.onStatus(`rodando ${name}…`)
        const { result, diff } = await runToolFull(name, args)
        ev.pushItem({ kind: 'tool', name, preview, result, diff })
        this.history.push({ role: 'tool', tool_call_id: call.id, content: result })
        // memorizou um fato → recarrega o system pra ele valer já nesta sessão
        if (name === 'lembrar') this.reloadContext()
      }
      if (signal.aborted) {
        ev.onStatus(null)
        return
      }
    }
    ev.onStatus(null)
    ev.pushItem({ kind: 'system', tone: 'warn', text: `parou após ${maxSteps} passos de ferramenta` })
  }
}

const errMsg = (e: unknown): string => (e instanceof Error ? e.message : String(e))

export const modelLabel = (deployment: string): string => aliasOf(deployment)
