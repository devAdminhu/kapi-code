#!/usr/bin/env node
import { render } from 'ink'
import { createElement } from 'react'
import { App } from './ui/App.js'
import { runHeadless } from './headless.js'
import { MODELS, DEFAULT_ALIAS, resolveModel, aliasOf } from './models.js'
import { CREDIT_TOTAL } from './config.js'
import { loadSpend } from './spend.js'
import { loadSettings } from './settings.js'

const args = process.argv.slice(2)

const usage = (): void => {
  process.stdout.write(
    `kapi — agente de IA no terminal (multi-modelo, Azure)\n\n` +
      `USO\n` +
      `  kapi                       abre a TUI (modo agente, ${DEFAULT_ALIAS})\n` +
      `  kapi -m kimi               escolhe modelo inicial\n` +
      `  kapi -c                    retoma a última conversa\n` +
      `  kapi --chat                modo só-conversa (sem ferramentas)\n` +
      `  kapi --auto                executa tools sem confirmar (cuidado!)\n` +
      `\nHEADLESS (sem TUI, igual claude -p)\n` +
      `  kapi -p "pergunta"         responde no stdout e sai\n` +
      `  echo "texto" | kapi -p     lê o prompt do stdin\n` +
      `  kapi -p -q "x"             só a resposta (sem rodapé de custo)\n` +
      `  kapi -p --chat "oi"        headless sem ferramentas\n` +
      `\nINFO\n` +
      `  kapi --models              lista modelos\n` +
      `  kapi --gasto               mostra gasto acumulado\n` +
      `\nNA TUI (comandos slash, digite / pra autocompletar)\n` +
      `  /model /models /gasto /config /reset /compact /enxame\n` +
      `  /plano /reasoning /lembrar /system /agente /auto /sair\n` +
      `\nATALHOS\n` +
      `  ↑/↓ histórico · Tab completa · Shift+Tab plano · Ctrl+R raciocínio\n` +
      `  Esc cancela geração · Ctrl+C sai\n` +
      `\nTOOLS DO AGENTE\n` +
      `  shell (background) · ler/escrever/editar arquivo · editar_varios\n` +
      `  grep · glob · python · web · buscar · enxame · tarefas · lembrar\n`,
  )
}

const listModels = (): void => {
  process.stdout.write('modelos (preço $/1M tokens):\n')
  for (const m of MODELS) {
    process.stdout.write(
      `  ${m.alias.padEnd(10)} ${m.deployment.padEnd(22)} in $${m.inPrice}  out $${m.outPrice}  ${m.note}\n`,
    )
  }
}

const showSpend = (): void => {
  const s = loadSpend()
  const left = CREDIT_TOTAL - s.total_usd
  process.stdout.write(`gasto: $${s.total_usd.toFixed(4)} de $${CREDIT_TOTAL} · resta $${left.toFixed(2)}\n`)
  process.stdout.write(`tokens: ${s.in_tokens} in · ${s.out_tokens} out\n`)
  for (const [dep, c] of Object.entries(s.by_model).sort(([, a], [, b]) => b - a)) {
    process.stdout.write(`  ${aliasOf(dep).padEnd(12)} $${c.toFixed(5)}\n`)
  }
}

const readStdin = async (): Promise<string> => {
  const chunks: Buffer[] = []
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer)
  return Buffer.concat(chunks).toString('utf-8').trim()
}

// settings persistidas são a base; flags da CLI sobrescrevem
const saved = loadSettings()
let model = (resolveModel(saved.defaultModel) ?? resolveModel(DEFAULT_ALIAS)) as string
let auto = saved.auto
let agentMode = true
let print = false
let quiet = false
let continueSession = false
const positional: string[] = []

for (let i = 0; i < args.length; i++) {
  const a = args[i]
  if (a === '--help' || a === '-h') {
    usage()
    process.exit(0)
  } else if (a === '--models' || a === '-l') {
    listModels()
    process.exit(0)
  } else if (a === '--gasto' || a === '--custo' || a === '-g') {
    showSpend()
    process.exit(0)
  } else if (a === '-p' || a === '--print') {
    print = true
  } else if (a === '-q' || a === '--quiet') {
    quiet = true
  } else if (a === '-c' || a === '--continue') {
    continueSession = true
  } else if (a === '--auto') {
    auto = true
  } else if (a === '--chat') {
    agentMode = false
  } else if (a === '-m' || a === '--model') {
    const next = args[++i]
    const dep = next ? resolveModel(next) : null
    if (!dep) {
      process.stderr.write(`modelo inválido: ${next ?? ''} (use --models)\n`)
      process.exit(1)
    }
    model = dep
  } else if (a && !a.startsWith('-')) {
    positional.push(a)
  } else if (a) {
    process.stderr.write(`flag desconhecida: ${a} (use --help)\n`)
    process.exit(1)
  }
}

const run = async (): Promise<void> => {
  const stdinIsPipe = !process.stdin.isTTY
  // headless quando: -p explícito, OU veio prompt posicional, OU stdin é pipe
  const wantsHeadless = print || positional.length > 0 || stdinIsPipe

  if (wantsHeadless) {
    let prompt = positional.join(' ')
    if (!prompt && stdinIsPipe) prompt = await readStdin()
    if (!prompt) {
      process.stderr.write('nada pra processar — passe um prompt: kapi -p "sua pergunta"\n')
      process.exit(1)
    }
    await runHeadless(prompt, { model, agentMode, auto, quiet })
    return
  }

  render(createElement(App, { initialModel: model, agentMode, auto, continueSession }), {
    exitOnCtrlC: false,
  })
}

void run()
