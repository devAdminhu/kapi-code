import { exec, execFile, spawn } from 'node:child_process'
import { readFile, writeFile } from 'node:fs/promises'
import { readFileSync, existsSync, mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { promisify } from 'node:util'
import type { ToolDef } from './api/types.js'
import { KAPI_DIR } from './config.js'
import { appendMemory } from './context.js'
import { webFetch, webSearch } from './webfetch.js'
import { compactDiff, diffLines, type DiffLine } from './diff.js'

const execAsync = promisify(exec)
const execFileAsync = promisify(execFile)
const HOME = homedir()
const expand = (p: string): string => (p.startsWith('~') ? p.replace(/^~/, HOME) : p)
const cap = (s: string, n = 8000): string => (s.length > n ? s.slice(0, n) : s)

// processos em background: PID → caminho do log
const BG_DIR = join(KAPI_DIR, 'bg')
const BG_LOGS = new Map<number, string>()

export const TOOLS: ToolDef[] = [
  {
    type: 'function',
    function: {
      name: 'shell',
      description:
        'Executa um comando shell (bash) na máquina do João e retorna stdout+stderr. Use pra listar ' +
        'arquivos, checar status, rodar programas. Para processos longos (servidor, build, watch) passe ' +
        'background=true: roda destacado, retorna PID e loga em arquivo (leia depois com shell_log).',
      parameters: {
        type: 'object',
        properties: {
          comando: { type: 'string', description: 'o comando bash a executar' },
          background: { type: 'boolean', description: 'roda destacado sem travar (processos longos)' },
        },
        required: ['comando'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'shell_log',
      description: 'Lê a saída acumulada de um processo iniciado em background (pelo PID retornado).',
      parameters: {
        type: 'object',
        properties: { pid: { type: 'number', description: 'PID do processo em background' } },
        required: ['pid'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'ler_arquivo',
      description: 'Lê o conteúdo de um arquivo de texto.',
      parameters: {
        type: 'object',
        properties: { caminho: { type: 'string' } },
        required: ['caminho'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'escrever_arquivo',
      description: 'Escreve (cria/sobrescreve) um arquivo de texto com o conteúdo dado.',
      parameters: {
        type: 'object',
        properties: { caminho: { type: 'string' }, conteudo: { type: 'string' } },
        required: ['caminho', 'conteudo'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'editar_arquivo',
      description:
        'Edita um arquivo substituindo um trecho EXATO por outro (em vez de reescrever tudo). ' +
        'O texto_antigo deve aparecer uma única vez no arquivo, com a indentação exata.',
      parameters: {
        type: 'object',
        properties: {
          caminho: { type: 'string' },
          texto_antigo: { type: 'string', description: 'trecho exato a substituir' },
          texto_novo: { type: 'string', description: 'texto que entra no lugar' },
        },
        required: ['caminho', 'texto_antigo', 'texto_novo'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'editar_varios',
      description:
        'Aplica VÁRIAS edições no mesmo arquivo numa só operação, em ordem e de forma atômica ' +
        '(ou todas passam ou nenhuma). Cada edição tem texto_antigo/texto_novo. Use pra refatorar ' +
        'múltiplos trechos de um arquivo de uma vez.',
      parameters: {
        type: 'object',
        properties: {
          caminho: { type: 'string' },
          edicoes: {
            type: 'array',
            description: 'lista de {texto_antigo, texto_novo} aplicadas em ordem',
          },
        },
        required: ['caminho', 'edicoes'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'grep',
      description: 'Busca um padrão (regex) no conteúdo de arquivos e retorna os matches com arquivo:linha.',
      parameters: {
        type: 'object',
        properties: {
          padrao: { type: 'string', description: 'regex a buscar' },
          caminho: { type: 'string', description: 'diretório ou arquivo (default: .)' },
        },
        required: ['padrao'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'glob',
      description: 'Encontra arquivos por padrão glob (ex: **/*.ts, src/*.tsx). Retorna a lista de caminhos.',
      parameters: {
        type: 'object',
        properties: {
          padrao: { type: 'string', description: 'padrão glob' },
          caminho: { type: 'string', description: 'diretório base (default: .)' },
        },
        required: ['padrao'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'tarefas',
      description:
        'A TODO LIST nativa do Kapi (renderiza com checkboxes na tela). SEMPRE use esta ferramenta ' +
        'quando o usuário pedir uma "lista de tarefas", "todo list", "to-do", "checklist" ou pra ' +
        'acompanhar trabalho multi-passo — NÃO escreva um arquivo .json/.txt pra isso. Passe a lista ' +
        'completa de tarefas com status (pendente/fazendo/feito) toda vez que atualizar.',
      parameters: {
        type: 'object',
        properties: {
          lista: {
            type: 'array',
            description: 'tarefas como objetos {texto, status}',
          },
        },
        required: ['lista'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'python',
      description: 'Executa um trecho de código Python3 e retorna o que ele imprimir (stdout+stderr).',
      parameters: {
        type: 'object',
        properties: { codigo: { type: 'string' } },
        required: ['codigo'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'web',
      description:
        'Baixa uma URL e retorna o conteúdo principal já convertido em Markdown limpo ' +
        '(títulos, links, listas, código preservados). Use pra ler artigos, docs e páginas.',
      parameters: {
        type: 'object',
        properties: { url: { type: 'string' } },
        required: ['url'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'buscar',
      description:
        'Pesquisa na web (DuckDuckGo) e retorna os melhores resultados com título, URL e ' +
        'trecho. Use pra achar páginas/notícias atuais em vez de adivinhar URLs.',
      parameters: {
        type: 'object',
        properties: { consulta: { type: 'string', description: 'o que buscar' } },
        required: ['consulta'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'enxame',
      description:
        'Lança um ENXAME de subagentes em paralelo (capacidade nativa, NÃO é lib externa). Decompõe ' +
        'um objetivo grande em sub-tarefas, dispara exploradores/planejadores/executores ao mesmo ' +
        'tempo e sintetiza. Use quando a tarefa for grande e paralelizável (auditar, pesquisar amplo, ' +
        'comparar várias coisas). Passe o objetivo completo.',
      parameters: {
        type: 'object',
        properties: { objetivo: { type: 'string', description: 'o objetivo grande a ser atacado em paralelo' } },
        required: ['objetivo'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'lembrar',
      description:
        'Salva um fato importante na memória persistente do Kapi (sobrevive entre sessões). ' +
        'Use quando o João compartilhar algo que vale guardar: preferências, decisões, nomes, ' +
        'configs, contexto de projeto. Seja conciso — um fato por chamada.',
      parameters: {
        type: 'object',
        properties: { fato: { type: 'string', description: 'o fato a memorizar, em uma frase' } },
        required: ['fato'],
      },
    },
  },
]

export const DANGEROUS = new Set(['shell', 'escrever_arquivo', 'editar_arquivo', 'editar_varios', 'python'])

// padrões de comando claramente destrutivos — SEMPRE confirmam, mesmo em auto
// (a menos que liberado no /config). Conservador de propósito.
const DESTRUCTIVE_PATTERNS: RegExp[] = [
  /\brm\s+(-[a-z]*r[a-z]*f|-[a-z]*f[a-z]*r)\b/i, // rm -rf / -fr
  /\brm\s+-[a-z]*r\b.*\*/i, // rm -r com glob
  /\bmkfs\b/i,
  /\bdd\b[^|]*\bof=\/dev\//i, // dd of=/dev/...
  /\b(shutdown|reboot|halt|poweroff)\b/i,
  /:\(\)\s*\{.*\};:/, // fork bomb
  />\s*\/dev\/sd[a-z]/i, // overwrite de disco
  /\bgit\s+push\b.*(--force|-f)\b/i, // push forçado
  /\bdrop\s+(table|database|schema)\b/i, // SQL destrutivo
  /\btruncate\s+table\b/i,
  /\bchmod\s+-R\s+0?00\b/i,
  /\b(systemctl|service)\s+\w+\s+(stop|disable)\b/i,
  /\bkill(all)?\s+-9\b/i,
  /\brm\s+-[a-z]*\s+\/(\s|$|\*)/i, // rm em raiz
]

/** Comando claramente destrutivo? (pra forçar confirmação mesmo em auto) */
export const isDestructiveCommand = (cmd: string): boolean =>
  DESTRUCTIVE_PATTERNS.some(re => re.test(cmd))

/** A tool/args representam uma ação destrutiva? */
export const isDestructive = (name: string, args: Record<string, unknown>): boolean => {
  if (name === 'shell') return isDestructiveCommand(String(args.comando ?? ''))
  if (name === 'python') return /\bshutil\.rmtree|\bos\.remove|\bos\.rmdir|subprocess.*rm\s+-rf/i.test(String(args.codigo ?? ''))
  return false
}

export const TOOL_ICON: Record<string, string> = {
  shell: '🔧',
  shell_log: '📜',
  python: '🐍',
  escrever_arquivo: '📝',
  editar_arquivo: '✏️',
  editar_varios: '✏️',
  ler_arquivo: '📂',
  grep: '🔍',
  glob: '📁',
  tarefas: '✓',
  web: '🌐',
  buscar: '🔎',
  enxame: '🐝',
  lembrar: '🧠',
}

/** Resumo curto pra exibir antes de pedir confirmação. */
export const toolPreview = (name: string, args: Record<string, unknown>): string => {
  switch (name) {
    case 'shell':
      return String(args.comando ?? '') + (args.background ? '  [background]' : '')
    case 'shell_log':
      return `PID ${args.pid}`
    case 'python':
      return String(args.codigo ?? '')
    case 'escrever_arquivo':
      return `${args.caminho} (${String(args.conteudo ?? '').length} chars)`
    case 'editar_arquivo':
      return `${args.caminho}: ${String(args.texto_antigo ?? '').slice(0, 50)}…`
    case 'editar_varios':
      return `${args.caminho} (${Array.isArray(args.edicoes) ? args.edicoes.length : 0} edições)`
    case 'ler_arquivo':
      return String(args.caminho ?? '')
    case 'grep':
      return `${args.padrao} em ${args.caminho ?? '.'}`
    case 'glob':
      return `${args.padrao} em ${args.caminho ?? '.'}`
    case 'tarefas':
      return `${Array.isArray(args.lista) ? args.lista.length : 0} tarefas`
    case 'web':
      return String(args.url ?? '')
    case 'buscar':
      return String(args.consulta ?? '')
    case 'enxame':
      return String(args.objetivo ?? '')
    case 'lembrar':
      return String(args.fato ?? '')
    default:
      return ''
  }
}

// converte glob simples (**/*.ts, src/*.tsx) num regex pro grep do find
const globToRegex = (glob: string): string =>
  glob
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*\//g, '\u0001') // **/ = zero ou mais diretorios
    .replace(/\*\*/g, '\u0002') // ** solto = qualquer profundidade
    .replace(/\*/g, '[^/]*')
    .replace(/\?/g, '.') // ? do glob — antes dos placeholders (que contêm ?)
    .replace(/\u0001/g, '(?:.*/)?')
    .replace(/\u0002/g, '.*') + '$'

export const runTool = async (name: string, args: Record<string, unknown>): Promise<string> => {
  try {
    switch (name) {
      case 'lembrar': {
        const fato = String(args.fato ?? '').trim()
        if (!fato) return '[nada pra lembrar]'
        appendMemory(fato)
        return `[memorizado: ${fato}]`
      }
      case 'shell': {
        const cmd = String(args.comando)
        if (args.background) {
          const logPath = join(BG_DIR, `bg-${Date.now()}-${Math.floor(performance.now())}.log`)
          mkdirSync(BG_DIR, { recursive: true })
          // setsid destaca do processo pai; saída vai pro log
          const child = spawn('bash', ['-c', `${cmd} > ${JSON.stringify(logPath)} 2>&1`], {
            cwd: process.cwd(),
            detached: true,
            stdio: 'ignore',
          })
          child.unref()
          if (child.pid) BG_LOGS.set(child.pid, logPath)
          return `[background iniciado · PID ${child.pid} · log: ${logPath}]\nUse shell_log com esse PID pra ver a saída.`
        }
        const { stdout, stderr } = await execAsync(cmd, {
          cwd: process.cwd(),
          timeout: 120_000,
          maxBuffer: 10 * 1024 * 1024,
        }).catch((e: { stdout?: string; stderr?: string; message?: string }) => ({
          stdout: e.stdout ?? '',
          stderr: e.stderr ?? e.message ?? '',
        }))
        const out = `${stdout}${stderr}`.trim()
        return cap(out) || '[sem saída]'
      }
      case 'shell_log': {
        const pid = Number(args.pid)
        const logPath = BG_LOGS.get(pid)
        if (!logPath || !existsSync(logPath)) return `[sem log pro PID ${pid}]`
        let alive = false
        try {
          process.kill(pid, 0)
          alive = true
        } catch {
          alive = false
        }
        const content = readFileSync(logPath, 'utf-8')
        const tail = content.length > 8000 ? content.slice(-8000) : content
        return `[PID ${pid} · ${alive ? 'rodando' : 'terminou'}]\n${tail.trim() || '[sem saída ainda]'}`
      }
      case 'ler_arquivo': {
        const content = await readFile(expand(String(args.caminho)), 'utf-8')
        return cap(content)
      }
      case 'escrever_arquivo': {
        const path = expand(String(args.caminho))
        const content = String(args.conteudo ?? '')
        await writeFile(path, content, 'utf-8')
        return `[escrito ${content.length} chars em ${path}]`
      }
      case 'editar_arquivo': {
        const path = expand(String(args.caminho))
        const oldS = String(args.texto_antigo ?? '')
        const newS = String(args.texto_novo ?? '')
        if (!oldS) return '[texto_antigo vazio]'
        const content = await readFile(path, 'utf-8')
        const count = content.split(oldS).length - 1
        if (count === 0) return '[texto_antigo não encontrado no arquivo]'
        if (count > 1) return `[texto_antigo aparece ${count}x — torne-o único pra editar com segurança]`
        await writeFile(path, content.replace(oldS, newS), 'utf-8')
        return `[editado ${path}: 1 trecho substituído]`
      }
      case 'editar_varios': {
        const path = expand(String(args.caminho))
        const edicoes = Array.isArray(args.edicoes) ? args.edicoes : []
        if (!edicoes.length) return '[sem edições]'
        let content = await readFile(path, 'utf-8')
        // aplica em memória, em ordem; aborta tudo se alguma falhar (atômico)
        for (let i = 0; i < edicoes.length; i++) {
          const e = edicoes[i] as { texto_antigo?: string; texto_novo?: string }
          const oldS = String(e.texto_antigo ?? '')
          const newS = String(e.texto_novo ?? '')
          if (!oldS) return `[edição ${i + 1}: texto_antigo vazio — nada aplicado]`
          const count = content.split(oldS).length - 1
          if (count === 0) return `[edição ${i + 1}: trecho não encontrado — nada aplicado]`
          if (count > 1) return `[edição ${i + 1}: trecho aparece ${count}x — nada aplicado]`
          content = content.replace(oldS, newS)
        }
        await writeFile(path, content, 'utf-8')
        return `[editado ${path}: ${edicoes.length} trechos substituídos]`
      }
      case 'grep': {
        const pat = String(args.padrao ?? '')
        const where = expand(String(args.caminho ?? '.'))
        // execFile sem shell: o padrão chega intacto no grep (sem expansão de $ etc.)
        const { stdout } = await execFileAsync(
          'grep',
          ['-rnI', '--color=never', '--exclude-dir=node_modules', '--exclude-dir=.git', '-E', pat, where],
          { cwd: process.cwd(), timeout: 30_000, maxBuffer: 10 * 1024 * 1024 },
        ).catch((e: { stdout?: string }) => ({ stdout: e.stdout ?? '' }))
        const out = stdout.trim().split('\n').slice(0, 100).join('\n').trim()
        return cap(out) || '[nenhum match]'
      }
      case 'glob': {
        const pat = String(args.padrao ?? '')
        const base = resolve(process.cwd(), expand(String(args.caminho ?? '.')))
        // find sem shell + filtro do glob em JS (nada do padrão passa pelo bash)
        const { stdout } = await execFileAsync(
          'find',
          ['.', '-type', 'f', '-not', '-path', '*/node_modules/*', '-not', '-path', '*/.git/*'],
          { cwd: base, timeout: 30_000, maxBuffer: 10 * 1024 * 1024 },
        ).catch((e: { stdout?: string }) => ({ stdout: e.stdout ?? '' }))
        const re = new RegExp(globToRegex(pat), 'i')
        const out = stdout
          .split('\n')
          .filter(l => l && re.test(l))
          .slice(0, 200)
          .join('\n')
        return out || '[nenhum arquivo]'
      }
      case 'tarefas': {
        const lista = Array.isArray(args.lista) ? args.lista : []
        // estilo Claude Code: checkbox limpo ☒ feito, ▣ fazendo, ☐ pendente
        const icon = (s: string): string =>
          s === 'feito' || s === 'done' ? '☒' : s === 'fazendo' || s === 'in_progress' ? '▣' : '☐'
        const lines = lista.map((t: unknown) => {
          const item = t as { texto?: string; status?: string }
          return `${icon(item.status ?? 'pendente')} ${item.texto ?? ''}`
        })
        return lines.length ? lines.join('\n') : '[lista vazia]'
      }
      case 'python': {
        const code = String(args.codigo)
        // execFile sem shell: código com $, `` ou aspas chega intacto no python3
        const { stdout, stderr } = await execFileAsync(
          'python3',
          ['-c', code],
          { cwd: process.cwd(), timeout: 120_000, maxBuffer: 10 * 1024 * 1024 },
        ).catch((e: { stdout?: string; stderr?: string; message?: string }) => ({
          stdout: e.stdout ?? '',
          stderr: e.stderr ?? e.message ?? '',
        }))
        return cap(`${stdout}${stderr}`.trim()) || '[sem saída]'
      }
      case 'web': {
        const r = await webFetch(String(args.url))
        const head = r.title ? `# ${r.title}\n${r.url}\n\n` : `${r.url}\n\n`
        return head + r.markdown + (r.truncated ? '\n\n[…conteúdo truncado]' : '')
      }
      case 'buscar': {
        const hits = await webSearch(String(args.consulta))
        if (!hits.length) return '[nenhum resultado]'
        return hits
          .map((h, i) => {
            const snip = h.snippet ? (h.snippet.length > 160 ? `${h.snippet.slice(0, 160)}…` : h.snippet) : ''
            const head = h.source ? `${h.title}  (${h.source})` : h.title
            return `${i + 1}. ${head}${snip ? `\n   ${snip}` : ''}\n   ${h.url}`
          })
          .join('\n\n')
      }
      default:
        return `[ferramenta desconhecida: ${name}]`
    }
  } catch (e) {
    return `[erro na ferramenta ${name}: ${e instanceof Error ? e.message : String(e)}]`
  }
}

export const parseToolArgs = (raw: string): Record<string, unknown> => {
  try {
    return JSON.parse(raw || '{}') as Record<string, unknown>
  } catch {
    return {}
  }
}

const EDIT_TOOLS = new Set(['editar_arquivo', 'editar_varios', 'escrever_arquivo'])

/**
 * Roda a tool e, se for de edição, captura o diff (antes/depois) pra UI mostrar
 * colorido. Lê o arquivo antes e depois pra gerar o diff por linha.
 */
export const runToolFull = async (
  name: string,
  args: Record<string, unknown>,
): Promise<{ result: string; diff?: DiffLine[] }> => {
  if (!EDIT_TOOLS.has(name)) return { result: await runTool(name, args) }

  const path = expand(String(args.caminho ?? ''))
  let before = ''
  try {
    before = existsSync(path) ? readFileSync(path, 'utf-8') : ''
  } catch {
    before = ''
  }
  const result = await runTool(name, args)
  let after = before
  try {
    after = existsSync(path) ? readFileSync(path, 'utf-8') : before
  } catch {
    after = before
  }
  if (before === after) return { result }
  const diff = compactDiff(diffLines(before, after))
  return { result, diff }
}
