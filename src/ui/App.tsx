import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Box, Static, Text, useApp, useInput } from 'ink'
import { theme } from '../theme.js'
import { CREDIT_TOTAL } from '../config.js'
import { aliasOf, estimateTokens, resolveModel } from '../models.js'
import { ctxLimit, refreshCtxWindows } from '../ctxwindow.js'
import { appendMemory, contextSummary } from '../context.js'
import { loadSpend, type Spend } from '../spend.js'
import { Engine, type ChatItem } from '../engine.js'
import type { ImagePart } from '../api/types.js'
import { StatusLine } from './Banner.js'
import { Welcome } from './Welcome.js'
import { MessageRow, type ReasoningMode } from './MessageRow.js'
import { InputBox } from './InputBox.js'
import { Spinner } from './Spinner.js'
import { Confirm, type ConfirmRequest } from './Confirm.js'
import { ModelsPanel, SpendPanel } from './Panels.js'
import { ConfigPanel } from './ConfigPanel.js'
import { LoginPanel } from './LoginPanel.js'
import { PlanExit } from './PlanExit.js'
import { loadSettings, saveSettings, type Settings } from '../settings.js'
import { setLang } from '../i18n.js'

type Props = { initialModel: string; agentMode: boolean; auto: boolean; continueSession?: boolean }

// itens com id estável pra <Static> não re-renderizar histórico
type Entry = { id: number; item: ChatItem }

export const App = ({ initialModel, agentMode, auto, continueSession }: Props) => {
  const { exit } = useApp()
  const engineRef = useRef<Engine | null>(null)
  if (!engineRef.current) engineRef.current = new Engine(initialModel, agentMode, auto)
  const engine = engineRef.current

  const idRef = useRef(0)
  const [entries, setEntries] = useState<Entry[]>([])
  const [model, setModel] = useState(initialModel)
  const [autoMode, setAutoMode] = useState(auto)
  const [agent, setAgent] = useState(agentMode)
  const [spend, setSpend] = useState<Spend>(() => loadSpend())
  const [status, setStatus] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [live, setLive] = useState<{ model: string; text: string; reasoning: string } | null>(null)
  const [confirmReq, setConfirmReq] = useState<ConfirmRequest | null>(null)
  const [panel, setPanel] = useState<'none' | 'models' | 'spend' | 'config' | 'login'>('none')
  const [settings, setSettings] = useState<Settings>(() => loadSettings())
  const [ctxTokens, setCtxTokens] = useState(0)
  const [ctxTick, setCtxTick] = useState(0) // força re-render quando o ctxwindow chega
  const [reasoningMode, setReasoningMode] = useState<ReasoningMode>('hidden')
  const [planMode, setPlanMode] = useState(false)
  const [planExit, setPlanExit] = useState(false)
  const [sentHistory, setSentHistory] = useState<string[]>([])
  const [draft, setDraft] = useState<string | null>(null) // texto devolvido pro input (fila cancelada)
  const [liveTokens, setLiveTokens] = useState(0) // tokens de saída do turno (real + streaming)
  const turnStartRef = useRef(0) // epoch ms do início do turno atual
  const curGenRef = useRef(0) // tokens estimados da geração em streaming agora
  const queueRef = useRef<string[]>([]) // mensagens digitadas durante o processamento
  const abortRef = useRef<AbortController | null>(null)
  const confirmRef = useRef<ConfirmRequest | null>(null) // confirm pendente (pra resolver no cancel)
  // throttle do streaming: coalesce os deltas SSE em ~1 frame/50ms pra não
  // redesenhar o frame inteiro a cada token (mata lag/flicker em modelo rápido)
  const liveBufRef = useRef<{ m: string; text: string; reasoning: string } | null>(null)
  const flushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const push = useCallback((item: ChatItem) => {
    setEntries(prev => [...prev, { id: idRef.current++, item }])
  }, [])

  const handlePlanExit = useCallback(
    (choice: 'keep' | 'fresh' | 'cancel') => {
      setPlanExit(false)
      if (choice === 'cancel') return
      const plan = engine.lastAssistantText()
      setPlanMode(false)
      if (choice === 'keep') {
        engine.setPlanMode(false)
        push({ kind: 'system', text: '✅ plano aprovado — construindo com todo o contexto' })
      } else {
        // fresh: limpa a UI e segue só com o plano
        engine.applyPlanFresh(plan)
        setEntries([])
        setCtxTokens(0)
        push({ kind: 'system', text: '✅ plano aprovado — janela nova, construindo a partir do plano' })
      }
    },
    [engine, push],
  )

  const togglePlan = useCallback(() => {
    if (busy) return
    if (!planMode) {
      // ligando
      setPlanMode(true)
      engine.setPlanMode(true)
      push({ kind: 'system', tone: 'warn', text: '📋 modo plano ON — só investiga e propõe plano' })
      return
    }
    // desligando: se há um plano proposto, pergunta como continuar
    const plan = engine.lastAssistantText()
    if (plan) {
      setPlanExit(true)
    } else {
      setPlanMode(false)
      engine.setPlanMode(false)
      push({ kind: 'system', tone: 'info', text: 'modo plano OFF' })
    }
  }, [busy, planMode, engine, push])

  // busca as janelas de contexto reais (OpenRouter) em background no boot.
  // stale-while-revalidate: aplica cache na hora, revalida e re-renderiza.
  useEffect(() => {
    void refreshCtxWindows(Date.now(), () => setCtxTick(t => t + 1)).then(() => setCtxTick(t => t + 1))
  }, [])

  // no boot, mostra o que foi carregado no contexto (KAPI.md, memória)
  // e aplica TODAS as settings persistidas no engine + estado
  useEffect(() => {
    const summary = contextSummary()
    if (summary) push({ kind: 'system', text: `📎 contexto: ${summary}` })
    engine.allowDestructive = settings.allowDestructive
    engine.auto = settings.auto
    setAutoMode(settings.auto)
    setReasoningMode(settings.reasoning)
    setLang(settings.lang)
    // NÃO sobrescrever o modelo aqui: initialModel já reflete -m <alias> ou o
    // defaultModel das settings (resolvido no index.tsx). Sobrescrever ignorava o -m.
    // retoma a última sessão se rodou com -c
    if (continueSession) {
      const restored = engine.restoreSession()
      if (restored && restored.length) {
        setEntries(restored.map(item => ({ id: idRef.current++, item })))
        setCtxTokens(engine.contextTokens())
        push({ kind: 'system', text: '↺ sessão anterior retomada' })
      } else {
        push({ kind: 'system', tone: 'info', text: 'nenhuma sessão anterior pra retomar' })
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // autosave da sessão sempre que o histórico muda (pra retomar com -c).
  // debounce: numa rajada de tool calls evita reescrever o JSON inteiro a cada item
  useEffect(() => {
    if (entries.length === 0) return
    const t = setTimeout(() => engine.saveSession(entries.map(e => e.item)), 400)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entries])

  // Ctrl+C: cancela geração em andamento ou sai
  const cycleReasoning = useCallback(() => {
    setReasoningMode(m => {
      const next: ReasoningMode = m === 'short' ? 'full' : m === 'full' ? 'hidden' : 'short'
      push({ kind: 'system', text: `raciocínio: ${next === 'full' ? 'completo' : next === 'hidden' ? 'escondido' : 'resumido'}` })
      return next
    })
  }, [push])

  const cancelGen = useCallback(() => {
    if (busy && abortRef.current) {
      abortRef.current.abort()
      // se há confirmação pendente, recusa — senão a Promise fica pendurada
      // e a tool executaria mesmo depois do cancelamento
      confirmRef.current?.resolve(false)
      setBusy(false)
      setStatus(null)
      setLive(null)
      push({ kind: 'system', tone: 'warn', text: 'cancelado.' })
      // mensagens enfileiradas voltam pro input (em vez de sumir)
      const queued = queueRef.current.splice(0)
      if (queued.length) {
        setDraft(queued.join(' '))
        push({ kind: 'system', tone: 'info', text: '↩ fila devolvida pro input — edite e reenvie' })
      }
    }
  }, [busy, push])

  useInput((_input, key) => {
    // Esc cancela a geração em andamento (sem mexer no input vazio)
    if (key.escape && busy) {
      cancelGen()
      return
    }
    if (key.ctrl && _input === 'c') {
      if (busy && abortRef.current) {
        cancelGen()
      } else {
        exit()
      }
      return
    }
    if (key.ctrl && _input === 'r') cycleReasoning()
    if (key.shift && key.tab) togglePlan()
  })

  const run = useCallback(
    async (text: string, images?: ImagePart[]) => {
      const ctrl = new AbortController()
      abortRef.current = ctrl
      setBusy(true)
      setPanel('none')
      // métricas do turno pro status (Xs · ↑ Yk tokens)
      turnStartRef.current = Date.now()
      curGenRef.current = 0
      setLiveTokens(0)
      try {
        await engine.send(text, {
          pushItem: push,
          onAssistantDelta: (m, partial, reasoning) => {
            if (partial || reasoning) {
              // bufferiza o último estado; o flusher empurra no máximo 1x/50ms
              liveBufRef.current = { m, text: partial, reasoning }
              if (!flushTimerRef.current) {
                flushTimerRef.current = setTimeout(() => {
                  flushTimerRef.current = null
                  const b = liveBufRef.current
                  if (!b) return
                  curGenRef.current = estimateTokens(b.text) + estimateTokens(b.reasoning)
                  setLiveTokens(engine.turnOutTokens + curGenRef.current)
                  setLive({ model: b.m, text: b.text, reasoning: b.reasoning })
                }, 50)
              }
            } else {
              // fim do streaming: cancela flush pendente e limpa imediatamente
              if (flushTimerRef.current) {
                clearTimeout(flushTimerRef.current)
                flushTimerRef.current = null
              }
              liveBufRef.current = null
              curGenRef.current = 0
              setLive(null)
            }
          },
          onStatus: setStatus,
          onSpendChange: () => {
            setSpend(loadSpend())
            setCtxTokens(engine.contextTokens())
            // usage real chegou (inclui tool calls): atualiza o contador do status
            setLiveTokens(engine.turnOutTokens + curGenRef.current)
          },
          confirm: (name, preview) =>
            new Promise<boolean>(resolve => {
              const req: ConfirmRequest = {
                name,
                preview,
                resolve: ok => {
                  confirmRef.current = null
                  setConfirmReq(null)
                  resolve(ok)
                },
              }
              confirmRef.current = req
              setConfirmReq(req)
            }),
        }, ctrl.signal, images)
      } finally {
        setBusy(false)
        setStatus(null)
        setLive(null)
        setCtxTokens(engine.contextTokens())
        abortRef.current = null
        // processa a próxima mensagem enfileirada (digitada durante o processamento)
        const next = queueRef.current.shift()
        if (next && !ctrl.signal.aborted) setTimeout(() => void run(next), 0)
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [engine, push],
  )

  const compactNow = useCallback(async () => {
    const ctrl = new AbortController()
    abortRef.current = ctrl
    setBusy(true)
    setPanel('none')
    turnStartRef.current = Date.now()
    curGenRef.current = 0
    setLiveTokens(0)
    try {
      const r = await engine.compact(
        {
          pushItem: push,
          onAssistantDelta: () => {},
          onStatus: setStatus,
          onSpendChange: () => setSpend(loadSpend()),
          confirm: async () => true,
        },
        ctrl.signal,
      )
      if (r) {
        setEntries([])
        push({
          kind: 'system',
          text: `compactado: ${r.before.toLocaleString('pt-BR')} → ${r.after.toLocaleString('pt-BR')} tokens`,
        })
      } else {
        push({ kind: 'system', tone: 'info', text: 'nada pra compactar ainda.' })
      }
    } finally {
      setBusy(false)
      setStatus(null)
      setCtxTokens(engine.contextTokens())
      abortRef.current = null
    }
  }, [engine, push])

  const swarmNow = useCallback(
    async (objetivo: string) => {
      const ctrl = new AbortController()
      abortRef.current = ctrl
      setBusy(true)
      setPanel('none')
      turnStartRef.current = Date.now()
      curGenRef.current = 0
      setLiveTokens(0)
      try {
        await engine.swarm(objetivo, {
          pushItem: push,
          onAssistantDelta: (m, partial, reasoning) =>
            setLive(partial || reasoning ? { model: m, text: partial, reasoning } : null),
          onStatus: setStatus,
          onSpendChange: () => setSpend(loadSpend()),
          confirm: async () => true,
        }, ctrl.signal)
      } finally {
        setBusy(false)
        setStatus(null)
        setLive(null)
        setCtxTokens(engine.contextTokens())
        abortRef.current = null
      }
    },
    [engine, push],
  )

  const handleSubmit = useCallback(
    (raw: string, images?: ImagePart[]) => {
      const text = raw.trim()
      if (!text && !images?.length) return
      if (text) setSentHistory(h => (h[h.length - 1] === text ? h : [...h, text]))
      if (text.startsWith('/')) {
        handleCommand(text)
        return
      }
      // se o agente está ocupado, enfileira em vez de bloquear/interferir
      // (imagens não vão pra fila — só no envio imediato)
      if (busy) {
        queueRef.current.push(text)
        push({ kind: 'system', text: `⏳ na fila: ${text.length > 60 ? text.slice(0, 60) + '…' : text}` })
        return
      }
      void run(text, images)
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [run, busy, push],
  )

  const handleCommand = (cmd: string): void => {
    const [name, ...rest] = cmd.split(' ')
    const arg = rest.join(' ').trim()
    switch (name) {
      case '/sair':
      case '/quit':
      case '/exit':
        exit()
        return
      case '/reset':
        engine.reset()
        setEntries([])
        setCtxTokens(0)
        push({ kind: 'system', text: 'histórico limpo.' })
        return
      case '/compact':
        void compactNow()
        return
      case '/reasoning':
        cycleReasoning()
        return
      case '/plano':
      case '/plan':
        togglePlan()
        return
      case '/enxame':
        if (!arg) {
          push({ kind: 'system', tone: 'error', text: 'uso: /enxame <objetivo grande>' })
          return
        }
        void swarmNow(arg)
        return
      case '/lembrar':
        if (!arg) {
          push({ kind: 'system', tone: 'error', text: 'uso: /lembrar <fato>' })
          return
        }
        appendMemory(arg)
        engine.reloadContext()
        push({ kind: 'system', text: `🧠 memorizado: ${arg}` })
        return
      case '/config':
        setPanel(p => (p === 'config' ? 'none' : 'config'))
        return
      case '/login':
        setPanel(p => (p === 'login' ? 'none' : 'login'))
        return
      case '/gasto':
      case '/custo':
        setSpend(loadSpend())
        setPanel(p => (p === 'spend' ? 'none' : 'spend'))
        return
      case '/auto': {
        const next = !autoMode
        engine.auto = next
        setAutoMode(next)
        push({ kind: 'system', tone: next ? 'warn' : 'info', text: `auto-exec: ${next ? 'LIGADO (cuidado!)' : 'desligado'}` })
        return
      }
      case '/agente': {
        const next = !agent
        engine.setMode(next)
        setAgent(next)
        push({ kind: 'system', text: `modo: ${next ? 'agente (com ferramentas)' : 'chat (sem ferramentas)'}` })
        return
      }
      case '/model': {
        if (!arg) {
          setPanel(p => (p === 'models' ? 'none' : 'models'))
          return
        }
        const dep = resolveModel(arg)
        if (!dep) {
          push({ kind: 'system', tone: 'error', text: 'modelo não achado — /model sem arg abre a lista' })
          return
        }
        engine.model = dep
        setModel(dep)
        push({ kind: 'system', text: `agora: ${aliasOf(dep)} (${dep})` })
        return
      }
      case '/system': {
        if (!arg) {
          push({ kind: 'system', tone: 'error', text: 'uso: /system <texto>' })
          return
        }
        engine.setSystem(arg)
        setEntries([])
        push({ kind: 'system', text: 'system atualizado + histórico limpo.' })
        return
      }
      default:
        push({ kind: 'system', tone: 'error', text: `comando desconhecido: ${name}` })
    }
  }

  const liveItem: ChatItem | null = useMemo(
    () => (live ? { kind: 'assistant', model: live.model, text: live.text, reasoning: live.reasoning } : null),
    [live],
  )

  // O <Static> imprime, em ordem e uma única vez, banner → cada mensagem do
  // histórico. Tudo que é "vivo" (streaming, painéis, input, statusline) fica
  // FORA do Static, no frame dinâmico embaixo. Sem isso o histórico subia pro
  // topo da tela e a resposta aparecia acima do banner.
  type StaticRow = { id: string; node: React.ReactNode }
  const staticRows: StaticRow[] = useMemo(
    () => [
      { id: 'welcome', node: <Welcome model={model} auto={autoMode} /> },
      ...entries.map(e => ({
        id: `m-${e.id}`,
        node: <MessageRow item={e.item} reasoningMode={reasoningMode} />,
      })),
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [entries, reasoningMode],
  )

  return (
    <Box flexDirection="column">
      <Static items={staticRows}>{row => <Box key={row.id}>{row.node}</Box>}</Static>

      {/* resposta em streaming ao vivo */}
      {liveItem && <MessageRow item={liveItem} reasoningMode={reasoningMode} />}

      {panel === 'models' && (
        <ModelsPanel
          current={model}
          onSelect={dep => {
            engine.model = dep
            setModel(dep)
            setPanel('none')
            push({ kind: 'system', text: `agora: ${aliasOf(dep)} (${dep})` })
          }}
          onClose={() => setPanel('none')}
        />
      )}
      {panel === 'spend' && <SpendPanel spend={spend} />}
      {panel === 'login' && <LoginPanel onClose={() => setPanel('none')} />}
      {panel === 'config' && (
        <ConfigPanel
          settings={settings}
          onChange={next => {
            setSettings(next)
            saveSettings(next)
            // aplica no vivo
            const dep = resolveModel(next.defaultModel)
            if (dep) {
              engine.model = dep
              setModel(dep)
            }
            engine.auto = next.auto
            setAutoMode(next.auto)
            engine.allowDestructive = next.allowDestructive
            setReasoningMode(next.reasoning)
            setLang(next.lang)
            engine.lang = next.lang
            engine.reloadContext()
          }}
          onClose={() => setPanel('none')}
        />
      )}

      {confirmReq && <Confirm req={confirmReq} />}

      {planExit && <PlanExit onChoice={handlePlanExit} />}

      {status && !confirmReq && (
        <Box marginBottom={1}>
          <Spinner
            label={status}
            startedAt={turnStartRef.current || undefined}
            outTokens={liveTokens}
            inTokens={ctxTokens}
            thinking={!!live?.reasoning && !live?.text}
          />
        </Box>
      )}

      {!confirmReq && !planExit && panel !== 'config' && panel !== 'models' && panel !== 'login' && (
        <InputBox
          onSubmit={handleSubmit}
          busy={busy}
          history={sentHistory}
          draft={draft}
          onDraftUsed={() => setDraft(null)}
          onNotice={msg => push({ kind: 'system', tone: 'info', text: msg })}
        />
      )}

      {/* statusline ao vivo (modelo · contexto% · custo% · modo) abaixo do input */}
      <StatusLine
        key={ctxTick}
        model={model}
        agentMode={agent}
        auto={autoMode}
        planMode={planMode}
        usedUsd={spend.total_usd}
        creditTotal={CREDIT_TOTAL}
        ctxTokens={ctxTokens}
        ctxLimit={ctxLimit(model)}
      />
    </Box>
  )
}
