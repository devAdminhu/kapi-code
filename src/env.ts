// Contexto de ambiente DINÂMICO injetado no system prompt em runtime (igual o
// Claude Code faz): SO, shell, diretórios, data. Nada hardcodado.
import { homedir, platform, release, hostname } from 'node:os'
import { basename } from 'node:path'

const PLATFORM_NAME: Record<string, string> = {
  linux: 'Linux',
  darwin: 'macOS',
  win32: 'Windows',
}

/** Bloco de ambiente pra anexar no system prompt. `now` injetado (Date). */
export const envBlock = (now: Date): string => {
  const cwd = process.cwd()
  const shell = basename(process.env.SHELL ?? 'sh')
  const os = PLATFORM_NAME[platform()] ?? platform()
  const date = now.toISOString().slice(0, 10)
  const lines = [
    `- Sistema: ${os} ${release()}`,
    `- Shell: ${shell}`,
    `- Diretório atual: ${cwd}`,
    `- Home: ${homedir()}`,
    `- Host: ${hostname()}`,
    `- Data: ${date}`,
  ]
  return `# Ambiente\n${lines.join('\n')}`
}
