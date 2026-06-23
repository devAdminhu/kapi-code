// Settings persistentes do Kapi em ~/.kapi-code/config.json (escrita atômica).
import { readFileSync, writeFileSync, renameSync, existsSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { KAPI_DIR } from './config.js'
import { DEFAULT_ALIAS } from './models.js'

const SETTINGS_PATH = join(KAPI_DIR, 'config.json')

export type Settings = {
  defaultModel: string // alias
  auto: boolean // auto-exec de tools
  allowDestructive: boolean // libera rm -rf etc sem confirmar
  reasoning: 'short' | 'full' | 'hidden'
  lang: 'pt' | 'en'
}

const DEFAULTS: Settings = {
  defaultModel: DEFAULT_ALIAS,
  auto: false,
  allowDestructive: false,
  reasoning: 'hidden', // raciocínio escondido por padrão — liga com Ctrl+R
  lang: 'pt',
}

export const loadSettings = (): Settings => {
  if (!existsSync(SETTINGS_PATH)) return { ...DEFAULTS }
  try {
    const parsed = JSON.parse(readFileSync(SETTINGS_PATH, 'utf-8')) as Partial<Settings>
    return { ...DEFAULTS, ...parsed }
  } catch {
    return { ...DEFAULTS }
  }
}

export const saveSettings = (s: Settings): void => {
  try {
    mkdirSync(dirname(SETTINGS_PATH), { recursive: true })
    const tmp = `${SETTINGS_PATH}.tmp`
    writeFileSync(tmp, JSON.stringify(s, null, 2))
    renameSync(tmp, SETTINGS_PATH)
  } catch {
    // best-effort
  }
}
