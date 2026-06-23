# Kapi Code

Agente de IA autônomo no terminal — **Ink + React + TypeScript**, identidade visual
própria (HUD ciano/magenta). Multi-provider: Azure (OpenAI-compat), Anthropic (API key
ou OAuth Claude Pro/Max), z.ai (GLM), OpenAI, Google Gemini, OpenRouter e Groq. Streaming
token a token, modo agente com ferramentas reais, enxame multi-agente, compactação de
contexto, memória persistente, paste de imagem (Ctrl+V) e menção de arquivo com `@`.

```
██   ██  █████  ██████  ██
██  ██  ██   ██ ██   ██ ██
█████   ███████ ██████  ██
██  ██  ██   ██ ██      ██
██   ██ ██   ██ ██      ██
```

## Rodar

```bash
npm install
npm run dev          # abre a TUI
# ou, depois de instalado (ver abaixo):
kapi
```

A chave da Azure vem da env var `KAPI_API_KEY` ou de `~/kapi-code/.azure-ref.env`
(gitignored). Veja `.env.example`. Outros providers conectam via `/login`.

## Instalar como comando

```bash
npm run build
ln -sf ~/kapi-code/bin/kapi ~/.local/bin/kapi   # 'kapi' no PATH
kapi --help
```

## Recursos

### Conversa & modelos
- **Streaming** token a token, com bloco de raciocínio (reasoning) dos modelos que pensam
- **Multi-provider**: Azure, Anthropic, GLM, OpenAI, Gemini, OpenRouter, Groq
- **Login por provider** (`/login`): API key ou OAuth
- **Paste de imagem** com Ctrl+V
- **Menção de arquivo** com `@`
- **Janela de contexto dinâmica** na statusline
- **Tracking de custo** por resposta + acumulado + cota Azure

### Modo agente (ferramentas reais)
- `shell` (com `background` pra processos longos + `shell_log` pra ler a saída)
- `ler_arquivo` · `escrever_arquivo` · `editar_arquivo` (troca trecho) · `editar_varios` (atômico)
- `grep` (regex) · `glob` (padrão de arquivos) · `python`
- `web` (URL → markdown limpo, tipo WebFetch) · `buscar` (notícias via Google News RSS)
- `enxame` (multi-agente nativo) · `tarefas` (todo list) · `lembrar` (memória)
- **Diff colorido** ao editar (verde/vermelho, igual Claude Code)
- **Confirmação** antes de ação perigosa; **comandos destrutivos** (rm -rf, drop…) sempre confirmam

### Enxame multi-agente
Decompõe um objetivo grande em sub-tarefas, dispara subagentes em paralelo
(explorador / planejador / executor, cada um com seu system prompt) e sintetiza.
Use `/enxame <objetivo>` ou o agente aciona sozinho.

### Contexto otimizado (estilo Claude Code)
- **Auto-compact** quando o contexto enche (janela − 13k tokens), com prompt estruturado de 9 seções
- **Microcompact**: limpa tool_results antigos antes do compact total
- **Token estimation** por tipo (JSON ~2 bytes/token, prosa ~4)
- **Cache robusto** em disco: envelope versionado, escrita atômica, stale-while-revalidate

### KAPI.md & memória
- Lê `~/.kapi-code/KAPI.md` (global) + `KAPI.md`/`AGENTS.md` do projeto, injeta no system prompt
- Memória persistente em `~/.kapi-code/memory.md` (tool `lembrar` ou `/lembrar`)
- System prompt godmode: autônomo, ambiente injetado dinamicamente, genérico

### Plan mode
`Shift+Tab` ou `/plano`: o Kapi só investiga (read-only) e propõe um plano.
Ao aprovar, escolha continuar com todo o contexto ou começar uma janela nova só com o plano.

### UX
- Input minimalista (sem bordas laterais), autocomplete de slash (`/`)
- `↑/↓` navega o histórico de mensagens · digitação não-bloqueante (fila durante o processamento)
- `Esc` cancela a geração · `Ctrl+R` alterna raciocínio · verbos animados no spinner
- **i18n** português/inglês (trocável no `/config`)
- `/config`: menu de configuração persistente (modelo, auto, destrutivos, raciocínio, idioma)

## Comandos slash

`/model` `/login` `/gasto` `/config` `/reset` `/compact` `/enxame` `/plano`
`/reasoning` `/lembrar` `/system` `/agente` `/auto` `/sair`

`/model` sem argumento abre a lista de modelos; com argumento troca direto (`/model opus`).

## Headless (`-p`, igual `claude -p`)

```bash
kapi -p "qual o uptime? use shell"     # responde no stdout
echo "resuma isso" | kapi -p           # lê o prompt do stdin
kapi -p -q "só a resposta"             # sem rodapé de custo
kapi -p --chat "oi"                    # sem ferramentas
```

## Modelos

| apelido | deployment | provider | in $/1M | out $/1M |
|---|---|---|---|---|
| deepseek | DeepSeek-V4-Flash | azure | 0.27 | 1.10 |
| kimi | Kimi-K2.6 | azure | 0.66 | 3.30 |
| llama | Llama-4-Maverick | azure | 0.35 | 1.41 |
| mistral | Mistral-Large-3 | azure | 2.00 | 6.00 |
| oss | gpt-oss-120b | azure | 0.15 | 0.60 |
| grok | grok-4-20-reasoning | azure | 3.00 | 15.00 |
| o4 | o4-mini | azure | 1.21 | 2.20 |
| glm / glm-air | glm-5.2 / glm-4.7 | zai | 0.60 / 0.20 | 2.20 / 1.10 |
| opus | claude-opus-4-8 | anthropic | 5.00 | 25.00 |
| opus47 / opus45 | claude-opus-4-7 / 4-5 | anthropic | 5.00 | 25.00 |
| sonnet | claude-sonnet-4-6 | anthropic | 3.00 | 15.00 |
| haiku | claude-haiku-4-5 | anthropic | 1.00 | 5.00 |
| gpt / gpt-mini | gpt-5.4 / gpt-5.2 | openai | 2.50 / 1.75 | 15.00 / 14.00 |
| gemini / gemini-pro | gemini-3-flash / 2.5-pro | google | 0.50 / 1.25 | 3.00 / 10.00 |

Conexão por provider via `/login`. Imagem (Ctrl+V) só em modelos com visão.

## Build

```bash
npm run typecheck
npm run build
npm start
```

---

`v0.0.1  made with ♥ devAdminhu`
