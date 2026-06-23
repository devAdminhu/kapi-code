import { useEffect, useMemo, useRef, useState } from 'react'
import { Box, Text, useInput } from 'ink'
import { theme } from '../theme.js'
import { filterCommands } from '../commands.js'
import { t } from '../i18n.js'
import { SlashMenu } from './SlashMenu.js'
import { readClipboardImage } from '../clipboard.js'
import { filterFiles } from '../fileindex.js'
import type { ImagePart } from '../api/types.js'

type Props = {
  onSubmit: (value: string, images?: ImagePart[]) => void
  busy: boolean
  history: string[] // mensagens já enviadas, pra navegar com ↑
  draft?: string | null // texto injetado de fora (ex: fila devolvida no cancel)
  onDraftUsed?: () => void
  onNotice?: (msg: string) => void // feedback (ex: clipboard sem imagem)
}

// menu ativo só enquanto se digita o NOME do comando: "/" ... sem espaço ainda
const slashQuery = (value: string): string | null => {
  if (!value.startsWith('/')) return null
  if (value.includes(' ')) return null
  return value.slice(1)
}

// Caixa de input com autocomplete de slash + histórico (↑/↓). A digitação NUNCA
// é bloqueada — mesmo com o agente processando você pode escrever a próxima msg.
export const InputBox = ({ onSubmit, busy, history, draft, onDraftUsed, onNotice }: Props) => {
  const [value, setValue] = useState('')
  const [cursor, setCursor] = useState(0)
  const [sel, setSel] = useState(0)
  const [images, setImages] = useState<ImagePart[]>([]) // imagens coladas (Ctrl+V) pra próxima msg
  const histIdx = useRef(-1) // -1 = não navegando o histórico

  // texto injetado de fora (fila devolvida no Esc) vira o valor atual, editável
  useEffect(() => {
    if (draft != null && draft !== '') {
      setValue(draft)
      setCursor(draft.length)
      onDraftUsed?.()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft])

  const query = slashQuery(value)
  const matches = useMemo(() => (query === null ? [] : filterCommands(query)), [query])
  const menuOpen = query !== null && matches.length > 0
  const selSafe = Math.min(sel, Math.max(0, matches.length - 1))

  // menção de arquivo com @: token "@..." antes do cursor, sem espaço/@ no meio
  const atMatch = value.slice(0, cursor).match(/@([^\s@]*)$/)
  const atToken = atMatch ? { start: cursor - atMatch[0].length, query: atMatch[1]! } : null
  const fileMatches = useMemo(() => (atToken ? filterFiles(atToken.query) : []), [atToken?.query])
  const [fileSel, setFileSel] = useState(0)
  const fileMenuOpen = atToken !== null && !menuOpen && fileMatches.length > 0
  const fileSelSafe = Math.min(fileSel, Math.max(0, fileMatches.length - 1))

  const insertFile = (): void => {
    const f = fileMatches[fileSelSafe]
    if (!f || !atToken) return
    const next = value.slice(0, atToken.start) + f + ' ' + value.slice(cursor)
    setFileSel(0)
    setText(next, atToken.start + f.length + 1)
  }

  const setText = (next: string, cur: number): void => {
    setValue(next)
    setCursor(cur)
    setSel(0)
  }

  const complete = (): void => {
    const cmd = matches[selSafe]
    if (!cmd) return
    const next = cmd.hint ? `/${cmd.name} ` : `/${cmd.name}`
    setText(next, next.length)
  }

  useInput((input, key) => {
    // ── Ctrl+V: cola imagem do clipboard, salva em cache e insere [Image #N] ──
    if (key.ctrl && input === 'v') {
      const img = readClipboardImage()
      if (img) {
        setImages(a => [...a, { dataUrl: img.dataUrl, mediaType: img.mediaType }])
        const token = `[Image #${img.index}] `
        setText(value.slice(0, cursor) + token + value.slice(cursor), cursor + token.length)
      } else {
        onNotice?.('clipboard sem imagem (precisa de wl-paste ou xclip)')
      }
      return
    }

    // ── menu de menção de arquivo (@) ──
    if (fileMenuOpen && (key.upArrow || key.downArrow)) {
      setFileSel(s => {
        const n = fileMatches.length
        return key.upArrow ? (s - 1 + n) % n : (s + 1) % n
      })
      return
    }
    if (fileMenuOpen && (key.tab || key.return)) {
      insertFile()
      return
    }

    // ── navegação do menu de slash ──
    if (menuOpen && (key.upArrow || key.downArrow)) {
      setSel(s => {
        const n = matches.length
        return key.upArrow ? (s - 1 + n) % n : (s + 1) % n
      })
      return
    }
    if (menuOpen && key.tab) return complete()
    if (menuOpen && key.escape) return setText('', 0)

    // ── histórico de mensagens com ↑/↓ (quando o menu não está aberto) ──
    if (key.upArrow && !menuOpen) {
      if (history.length === 0) return
      const ni = histIdx.current < 0 ? history.length - 1 : Math.max(0, histIdx.current - 1)
      histIdx.current = ni
      const v = history[ni] ?? ''
      setValue(v)
      setCursor(v.length)
      return
    }
    if (key.downArrow && !menuOpen) {
      if (histIdx.current < 0) return
      const ni = histIdx.current + 1
      if (ni >= history.length) {
        histIdx.current = -1
        setText('', 0)
      } else {
        histIdx.current = ni
        const v = history[ni] ?? ''
        setValue(v)
        setCursor(v.length)
      }
      return
    }

    if (key.return) {
      if (menuOpen) {
        const cmd = matches[selSafe]
        if (cmd && !cmd.hint) {
          setText('', 0)
          onSubmit(`/${cmd.name}`)
          return
        }
        complete()
        return
      }
      const v = value.trim()
      if (!v && images.length === 0) return
      histIdx.current = -1
      const imgs = images
      setImages([])
      setText('', 0)
      onSubmit(v, imgs.length ? imgs : undefined) // o App decide rodar agora ou enfileirar se busy
      return
    }
    if (key.leftArrow) return setCursor(c => Math.max(0, c - 1))
    if (key.rightArrow) return setCursor(c => Math.min(value.length, c + 1))
    // ── atalhos estilo readline ──
    if (key.ctrl && input === 'a') return setCursor(0)
    if (key.ctrl && input === 'e') return setCursor(value.length)
    if (key.ctrl && input === 'u') return setText(value.slice(cursor), 0) // apaga do início até o cursor
    if (key.ctrl && input === 'w') {
      // apaga a palavra antes do cursor (+ espaços ao redor)
      const head = value.slice(0, cursor)
      const cut = /\S/.test(head) ? head.replace(/\s*\S+\s*$/, '') : ''
      return setText(cut + value.slice(cursor), cut.length)
    }
    if (key.backspace || key.delete) {
      if (cursor > 0) setText(value.slice(0, cursor - 1) + value.slice(cursor), cursor - 1)
      return
    }
    if (input && !key.ctrl && !key.meta) {
      histIdx.current = -1
      setText(value.slice(0, cursor) + input + value.slice(cursor), cursor + input.length)
    }
  })

  const before = value.slice(0, cursor)
  const at = value.slice(cursor, cursor + 1) || ' '
  const after = value.slice(cursor + 1)
  const showPlaceholder = value.length === 0

  return (
    <Box flexDirection="column">
      {menuOpen && <SlashMenu items={matches} selected={selSafe} />}
      {fileMenuOpen && (
        <Box flexDirection="column">
          {fileMatches.map((f, i) => (
            <Text key={f} color={i === fileSelSafe ? theme.kapi : theme.subtle}>
              {i === fileSelSafe ? '❯ ' : '  '}
              {f}
            </Text>
          ))}
          <Text color={theme.subtle}>  ↑↓ navega · Tab/Enter insere caminho</Text>
        </Box>
      )}
      {images.length > 0 && (
        <Box>
          <Text color={theme.accent}>🖼 {images.length} imagem(ns) anexada(s)</Text>
        </Box>
      )}
      {/* bordas só em cima e embaixo (estilo Claude) — sem laterais */}
      <Box
        borderStyle="single"
        borderTop
        borderBottom
        borderLeft={false}
        borderRight={false}
        borderColor={busy ? theme.warning : theme.border}
        flexDirection="row"
      >
        <Text color={busy ? theme.warning : theme.kapi} bold>
          {busy ? '⏳ ' : '❯ '}
        </Text>
        {showPlaceholder ? (
          <Text>
            <Text inverse> </Text>
            <Text color={theme.subtle}>{busy ? ' digite a próxima (vai pra fila)…' : ` ${t('placeholder')}`}</Text>
          </Text>
        ) : (
          <Text>
            <Text color={theme.text}>{before}</Text>
            <Text inverse>{at}</Text>
            <Text color={theme.text}>{after}</Text>
          </Text>
        )}
      </Box>
      {menuOpen && (
        <Box>
          <Text color={theme.subtle}>  ↑↓ navega · Tab completa · Enter executa · Esc cancela</Text>
        </Box>
      )}
    </Box>
  )
}
