// Lê uma imagem do clipboard e salva em cache (estilo Claude Code): o byte
// vem do clipboard via wl-paste (Wayland) ou xclip (X11), grava em
// ~/.kapi-code/image-cache/<sessão>/N.png e devolve o data URL pra anexar.

import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const SESSION = String(process.pid)
const CACHE_DIR = join(homedir(), '.kapi-code', 'image-cache', SESSION)
let counter = 0

export type PastedImage = { path: string; dataUrl: string; mediaType: string; index: number }

// tenta cada leitor de clipboard; o primeiro que devolver bytes de imagem vence.
const READERS: Array<{ cmd: string; args: string[] }> = [
  { cmd: 'wl-paste', args: ['--type', 'image/png'] },
  { cmd: 'xclip', args: ['-selection', 'clipboard', '-t', 'image/png', '-o'] },
]

export const readClipboardImage = (): PastedImage | null => {
  for (const { cmd, args } of READERS) {
    try {
      const buf = execFileSync(cmd, args, { maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] })
      if (buf && buf.length > 0) {
        mkdirSync(CACHE_DIR, { recursive: true })
        counter += 1
        const path = join(CACHE_DIR, `${counter}.png`)
        writeFileSync(path, buf)
        return {
          path,
          dataUrl: `data:image/png;base64,${buf.toString('base64')}`,
          mediaType: 'image/png',
          index: counter,
        }
      }
    } catch {
      // comando ausente ou clipboard sem imagem PNG: tenta o próximo
    }
  }
  return null
}
