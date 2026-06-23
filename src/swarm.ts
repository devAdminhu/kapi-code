// Sistema de enxame: fan-out de subagentes em paralelo numa tarefa grande.
// Cada subagente roda headless (streaming, sem TUI), com seu próprio prompt e
// opcionalmente seu próprio modelo. Os resultados são coletados e o modelo
// principal sintetiza. Concorrência limitada pra não estourar a API.
import { streamChat } from './api/client.js'
import type { ChatMessage } from './api/types.js'
import { registerUsage } from './spend.js'
import { resolveModel } from './models.js'
import { TOOLS, parseToolArgs, runTool } from './tools.js'

export type SubAgentTipo = 'explorador' | 'planejador' | 'executor'
export type SubAgentSpec = { tarefa: string; tipo?: SubAgentTipo; modelo?: string }
export type SubAgentResult = { tarefa: string; tipo: SubAgentTipo; modelo: string; saida: string; erro?: string }

// ferramentas de LEITURA liberadas pros subagentes. Sem escrita/shell de propósito:
// subagente roda em paralelo e sem confirmação — quem altera estado é o agente
// principal, com o fluxo normal de confirm.
const SUBAGENT_TOOL_NAMES = new Set(['ler_arquivo', 'grep', 'glob', 'web', 'buscar'])
const SUBAGENT_TOOLS = TOOLS.filter(t => SUBAGENT_TOOL_NAMES.has(t.function.name))
const MAX_SUBAGENT_STEPS = 6

const FERRAMENTAS_NOTA =
  'Você TEM ferramentas reais de leitura (ler_arquivo, grep, glob, web, buscar) — use-as pra ' +
  'apurar FATOS em vez de supor. Você NÃO pode editar arquivos nem rodar comandos.'

// system prompt especializado por tipo de subagente (igual Claude Code: Explore/Plan/geral)
const SUBAGENT_PROMPTS: Record<SubAgentTipo, string> = {
  explorador:
    'Você é um subagente EXPLORADOR do Kapi. Sua função é investigar e reunir informação: ' +
    `buscar, ler, mapear, resumir. ${FERRAMENTAS_NOTA} NÃO proponha grandes mudanças — só relate ` +
    'o que encontrou de forma densa e factual, com os detalhes que importam (arquivos, trechos, ' +
    'fontes). PT-BR conciso.',
  planejador:
    'Você é um subagente PLANEJADOR do Kapi. Recebe um problema e devolve um plano claro e ' +
    `acionável: passos ordenados, decisões, trade-offs e riscos. ${FERRAMENTAS_NOTA} Fundamente ` +
    'o plano no que está de verdade no código/contexto. Seja específico e direto, em PT-BR.',
  executor:
    'Você é um subagente EXECUTOR do Kapi. Recebe uma tarefa concreta e a resolve, devolvendo o ' +
    `resultado pronto e completo (código, texto, resposta). ${FERRAMENTAS_NOTA} Entregue o ` +
    'resultado final pronto pro coordenador aplicar. Direto ao ponto, sem enrolação, PT-BR.',
}

export type SwarmEvents = {
  onStart: (total: number) => void
  onAgentDone: (index: number, result: SubAgentResult) => void
  onSpendChange: () => void
}

const MAX_CONCURRENCY = 4

// roda um subagente com agent-loop próprio: pode chamar tools de leitura por
// até MAX_SUBAGENT_STEPS passos antes de entregar a resposta final
const runOne = async (
  spec: SubAgentSpec,
  defaultModel: string,
  signal: AbortSignal,
  onSpend?: () => void,
): Promise<SubAgentResult> => {
  const model = (spec.modelo && resolveModel(spec.modelo)) || defaultModel
  const tipo: SubAgentTipo = spec.tipo ?? 'executor'
  const messages: ChatMessage[] = [
    { role: 'system', content: SUBAGENT_PROMPTS[tipo] },
    { role: 'user', content: spec.tarefa },
  ]
  try {
    for (let step = 0; step < MAX_SUBAGENT_STEPS; step++) {
      const res = await streamChat(model, messages, {
        tools: SUBAGENT_TOOLS,
        temperature: 0.4,
        maxTokens: 2048,
        signal,
      })
      registerUsage(model, res.usage.in, res.usage.out)
      onSpend?.()
      messages.push({
        role: 'assistant',
        content: res.content || null,
        tool_calls: res.toolCalls.length ? res.toolCalls : undefined,
      })
      if (!res.toolCalls.length) {
        return { tarefa: spec.tarefa, tipo, modelo: model, saida: res.content.trim() }
      }
      for (const call of res.toolCalls) {
        const result = signal.aborted
          ? '[cancelado]'
          : await runTool(call.function.name, parseToolArgs(call.function.arguments))
        messages.push({ role: 'tool', tool_call_id: call.id, content: result })
      }
      if (signal.aborted) break
    }
    // estourou os passos (ou cancelou): força resposta final sem ferramentas
    messages.push({
      role: 'user',
      content: 'Limite de passos atingido. Entregue AGORA sua resposta final com o que apurou.',
    })
    const final = await streamChat(model, messages, { temperature: 0.4, maxTokens: 2048, signal })
    registerUsage(model, final.usage.in, final.usage.out)
    onSpend?.()
    return { tarefa: spec.tarefa, tipo, modelo: model, saida: final.content.trim() }
  } catch (e) {
    return {
      tarefa: spec.tarefa,
      tipo,
      modelo: model,
      saida: '',
      erro: e instanceof Error ? e.message : String(e),
    }
  }
}

/** Executa N subagentes com concorrência limitada, emitindo progresso. */
export const runSwarm = async (
  specs: SubAgentSpec[],
  defaultModel: string,
  ev: SwarmEvents,
  signal: AbortSignal,
): Promise<SubAgentResult[]> => {
  ev.onStart(specs.length)
  const results: SubAgentResult[] = new Array(specs.length)
  let cursor = 0

  const worker = async (): Promise<void> => {
    while (cursor < specs.length && !signal.aborted) {
      const index = cursor++
      const spec = specs[index]
      if (!spec) continue
      const result = await runOne(spec, defaultModel, signal, ev.onSpendChange)
      results[index] = result
      ev.onAgentDone(index, result)
      ev.onSpendChange()
    }
  }

  const pool = Array.from({ length: Math.min(MAX_CONCURRENCY, specs.length) }, () => worker())
  await Promise.all(pool)
  return results.filter(Boolean)
}

/** Pede ao modelo coordenador pra sintetizar os resultados dos subagentes. */
export const synthesize = async (
  objetivo: string,
  results: SubAgentResult[],
  model: string,
  signal: AbortSignal,
  onText?: (d: string) => void,
): Promise<{ texto: string; usageIn: number; usageOut: number }> => {
  const blocos = results
    .map((r, i) => `## Subagente ${i + 1}: ${r.tarefa}\n${r.erro ? `[erro: ${r.erro}]` : r.saida}`)
    .join('\n\n')
  const messages: ChatMessage[] = [
    {
      role: 'system',
      content:
        'Você é o coordenador do enxame. Recebeu o objetivo geral e os resultados de vários ' +
        'subagentes. Sintetize tudo numa resposta única, coerente e completa em PT-BR, ' +
        'resolvendo contradições e cobrindo o objetivo. Não repita os blocos crus — integre.',
    },
    { role: 'user', content: `Objetivo: ${objetivo}\n\nResultados dos subagentes:\n\n${blocos}` },
  ]
  const res = await streamChat(model, messages, {
    temperature: 0.4,
    maxTokens: 4096,
    signal,
    callbacks: onText ? { onText } : undefined,
  })
  return { texto: res.content.trim(), usageIn: res.usage.in, usageOut: res.usage.out }
}
