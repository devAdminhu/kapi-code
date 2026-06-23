# MISSÃO — Jarvis TUI

Construir uma **TUI nova (do zero)** chamada **Jarvis**: um agente de IA de terminal,
com o **visual/UX inspirado no kapi-code** (`~/kapi-code`), conversando com os **modelos
LLM gigantes hospedados na Azure do João** (via API REST OpenAI-compatible).

NÃO é pra mexer no `~/kapi-code` — é um projeto **separado**, aqui em `~/jarvis-tui`.
Pode INSPIRAR no kapi-code (ler o código dele como referência de estilo), mas o código é novo.

## Stack (igual ao kapi pra ter a mesma cara)
- **Ink 6 + React 19** (TUI em React no terminal) — é o que o kapi usa
- **TypeScript strict**, ES Modules
- Runtime/gerenciador: **npm** (não bun). `npm install`, `npm run dev`, `npm run build`
- Para rodar TS: usar `tsx` (`npm i -D tsx`) ou compilar com `tsc`. Dev: `tsx src/index.tsx`
- Libs visuais que o kapi usa: `chalk`, `cli-boxes`, `cli-highlight`, `supports-hyperlinks`

## Visual (capturar a vibe do kapi-code)
Referência: `~/kapi-code/src/components/` (Message.tsx, BaseTextInput.tsx, MessageRow.tsx)
e `~/kapi-code/src/utils/theme.ts`.

Paleta do kapi (use parecida):
- cor primária "claude": **verde bandeira** `rgb(0,168,89)`
- shimmer: amarelo ouro `rgb(220,180,30)`
- success `rgb(44,122,57)`, error `rgb(171,43,63)`
- spinner azul `rgb(87,105,247)`
- laranja de destaque `rgb(234,88,12)` / fast `rgb(255,106,0)`

Elementos que o kapi tem e o Jarvis deve ter:
- Banner/header bonito no topo (nome Jarvis + modelo atual + custo)
- Caixa de input embaixo com borda (estilo `BaseTextInput`)
- Mensagens em "rows" com prefixo colorido (você / jarvis / tool)
- Spinner enquanto pensa
- Streaming token a token na resposta
- Rodapé/statusline com modelo + gasto acumulado + cota restante

## Backend — Azure (JÁ FUNCIONA, credenciais prontas)
Credenciais em `~/jarvis-tui/.azure-ref.env` (e em `~/.azure-sp/claude-mcp.env`).
NÃO commitar essas credenciais. Ler de env/arquivo gitignored.

**Endpoint OpenAI-compatible (testado e funcionando):**
```
POST https://eastus2.api.cognitive.microsoft.com/openai/v1/chat/completions?api-version=preview
Headers: Authorization: Bearer <JARVIS_DEEPSEEK_KEY>   (ou  api-key: <key>)
         Content-Type: application/json
Body: {"model":"<deployment>","messages":[...],"max_tokens":4096,"stream":true,"stream_options":{"include_usage":true}}
```
(também funciona o endpoint `/models/chat/completions?api-version=2024-05-01-preview`)

A chave está na env var `JARVIS_DEEPSEEK_KEY` dentro do `.azure-ref.env`.

**Modelos deployados (deployment name → usar no campo "model"):**
| apelido | model (deployment) | in $/1M | out $/1M | nota |
|---|---|---|---|---|
| deepseek | DeepSeek-V4-Flash | 0.27 | 1.10 | rápido, default chat |
| kimi | Kimi-K2.6 | 0.66 | 3.30 | contexto gigante |
| llama | Llama-4-Maverick | 0.35 | 1.41 | |
| mistral | Mistral-Large-3 | 2.00 | 6.00 | |
| oss | gpt-oss-120b | 0.15 | 0.60 | mais barato |
| grok | grok-4-20-reasoning | 3.00 | 15.00 | melhor raciocínio, default agente |
| o4 | o4-mini | 1.21 | 2.20 | reasoning OpenAI |

São OpenAI-compatible, suportam **function/tool calling** e **streaming**.

## Funcionalidades (o que o Jarvis TUI deve fazer)
1. **Chat com streaming** trocando entre os 7 modelos (atalho ou comando /model)
2. **Modo agente com ferramentas** (function calling): shell, ler_arquivo, escrever_arquivo, python, web
   - Ações perigosas (shell/escrever/python) pedem CONFIRMAÇÃO na UI antes de rodar (com modo --auto pra pular)
3. **Tracking de custo**: tokens in/out por resposta + acumulado + cota de $200 (Free Trial Azure).
   Persistir em `~/.azure-sp/jarvis-gasto.json` (já existe esse arquivo, formato:
   `{"total_usd":float,"in_tokens":int,"out_tokens":int,"by_model":{dep:usd}}`)
4. **Histórico** de conversa na sessão
5. Comandos slash: /model /models /gasto /reset /system /sair /auto

## Referência: a CLI atual (versão simples, sem TUI)
Já existe `~/.local/bin/jarvis` — uma CLI em Python que faz TUDO isso mas em texto puro
(sem Ink/React). USE como referência funcional do comportamento (modelos, tools, custo,
endpoint, formato). A missão é refazer ISSO com a UI bonita Ink/React estilo kapi.

## Entregáveis
- Projeto npm/Ink funcional em `~/jarvis-tui`
- `npm run dev` abre a TUI
- README curto de como rodar
- `.gitignore` cobrindo `.azure-ref.env`, `node_modules`, credenciais
- Ao final: rodar e validar que conversa com pelo menos 2 modelos, streaming OK, custo aparece

## Regras
- TypeScript strict, sem `any` desnecessário, ES Modules, 2 espaços sem ponto-e-vírgula
- Credenciais NUNCA hardcoded nem commitadas
- Confirme antes de tool perigosa
- Visual caprichado, é o que o João mais quer (a cara do kapi)
- Footer de assinatura se fizer sentido: `v0.0.1  made with ♥ devAdminhu`
