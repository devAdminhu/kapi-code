// Modo -p / --print: roda sem TUI, imprime a resposta no stdout e sai.
// Igual `claude -p "..."`. Bom pra pipe e scripts.
import { Engine, type ChatItem } from './engine.js'
import { aliasOf } from './models.js'
import { CREDIT_TOTAL } from './config.js'
import { loadSpend } from './spend.js'

type Opts = { model: string; agentMode: boolean; auto: boolean; quiet: boolean }

export const runHeadless = async (prompt: string, opts: Opts): Promise<void> => {
  const { model, agentMode, auto, quiet } = opts
  // sem TTY a confirmação interativa não rola: força auto (como o claude -p)
  const engine = new Engine(model, agentMode, true)
  void auto

  const ctrl = new AbortController()
  const errOut = (s: string): void => {
    if (!quiet) process.stderr.write(s)
  }

  let exitCode = 0
  await engine.send(
    prompt,
    {
      pushItem: (item: ChatItem) => {
        switch (item.kind) {
          case 'assistant':
            if (item.text) process.stdout.write(item.text + '\n')
            break
          case 'tool':
            errOut(`\x1b[2m• ${item.name}: ${item.preview.slice(0, 80)}\x1b[0m\n`)
            break
          case 'system':
            if (item.tone === 'error') {
              errOut(`erro: ${item.text}\n`)
              exitCode = 1
            }
            break
        }
      },
      onAssistantDelta: () => {},
      onStatus: () => {},
      onSpendChange: () => {},
      confirm: async () => true, // headless sempre autoriza
    },
    ctrl.signal,
  )

  if (!quiet) {
    const s = loadSpend()
    errOut(
      `\x1b[2m↳ ${aliasOf(model)} · total $${s.total_usd.toFixed(4)} · resta $${(CREDIT_TOTAL - s.total_usd).toFixed(2)}\x1b[0m\n`,
    )
  }
  process.exit(exitCode)
}
