import { useState, useRef } from 'react'
import { Box, Text, useInput } from 'ink'
import { theme } from '../theme.js'
import { ALL_PROVIDERS, type Provider } from '../providers.js'
import { isConnected, setKey, removeCredential } from '../auth.js'
import { loginLocalhost, loginPasteStart } from '../oauth.js'

// Painel /login: lista os providers, mostra conectado/não e deixa colar a API
// key (Enter). OAuth (Anthropic/OpenAI/Google) entra por um fluxo à parte.
export const LoginPanel = ({ onClose }: { onClose: () => void }) => {
  const [sel, setSel] = useState(0)
  // idle = navegando · key = colando API key · paste = colando code do OAuth
  const [mode, setMode] = useState<'idle' | 'key' | 'paste'>('idle')
  const [buf, setBuf] = useState('')
  const [flash, setFlash] = useState('')
  const [pasteUrl, setPasteUrl] = useState('')
  const pasteFinish = useRef<((pasted: string, p: Provider) => Promise<void>) | null>(null)
  const provider = ALL_PROVIDERS[sel]!

  const startOAuth = (p: Provider): void => {
    if (!p.oauth) return
    setFlash('')
    if (p.oauth.mode === 'localhost') {
      setFlash(`abrindo browser pra ${p.name}…`)
      loginLocalhost(p, p.oauth)
        .then(() => setFlash(`${p.name} conectado via OAuth`))
        .catch(e => setFlash(`erro: ${e.message}`))
    } else {
      const { url, finish } = loginPasteStart(p.oauth)
      pasteFinish.current = finish
      setPasteUrl(url)
      setMode('paste')
    }
  }

  useInput((input, key) => {
    if (mode === 'key' || mode === 'paste') {
      if (key.return) {
        const v = buf.trim()
        if (mode === 'key') {
          if (v) {
            setKey(provider.id, v)
            setFlash(`${provider.name} conectado`)
          }
        } else if (v && pasteFinish.current) {
          setFlash(`validando code de ${provider.name}…`)
          pasteFinish.current(v, provider)
            .then(() => setFlash(`${provider.name} conectado via OAuth`))
            .catch(e => setFlash(`erro: ${e.message}`))
        }
        setBuf('')
        setMode('idle')
        return
      }
      if (key.escape) {
        setBuf('')
        setMode('idle')
        return
      }
      if (key.backspace || key.delete) return setBuf(b => b.slice(0, -1))
      if (input && !key.ctrl && !key.meta) setBuf(b => b + input)
      return
    }
    if (key.upArrow) return setSel(s => (s - 1 + ALL_PROVIDERS.length) % ALL_PROVIDERS.length)
    if (key.downArrow) return setSel(s => (s + 1) % ALL_PROVIDERS.length)
    if (key.return) {
      setFlash('')
      setMode('key')
      return
    }
    if (input === 'o' && provider.oauth) {
      startOAuth(provider)
      return
    }
    if (input === 'd' && isConnected(provider.id)) {
      removeCredential(provider.id)
      setFlash(`${provider.name} desconectado`)
      return
    }
    if (key.escape || input === 'q') onClose()
  })

  return (
    <Box flexDirection="column" borderStyle="round" borderColor={theme.border} paddingX={1} marginBottom={1}>
      <Text bold color={theme.kapi}>
        conectar provider
      </Text>
      <Box marginTop={1} flexDirection="column">
        {ALL_PROVIDERS.map((p, i) => {
          const on = isConnected(p.id)
          const focused = i === sel
          const oauth = p.authType !== 'key'
          return (
            <Box key={p.id}>
              <Text color={focused ? theme.accent : theme.dim}>{focused ? '› ' : '  '}</Text>
              <Text color={on ? theme.success : theme.subtle}>{on ? '● ' : '○ '}</Text>
              <Box width={22}>
                <Text bold color={focused ? theme.accent : theme.text}>
                  {p.name}
                </Text>
              </Box>
              <Text color={theme.subtle}>{on ? 'conectado' : oauth ? 'key ou OAuth' : 'API key'}</Text>
            </Box>
          )
        })}
      </Box>
      {mode === 'key' ? (
        <Box marginTop={1} flexDirection="column">
          <Text color={theme.dim}>
            cole a API key de <Text color={theme.accent}>{provider.name}</Text> e Enter:
          </Text>
          <Text>
            <Text color={theme.kapi}>❯ </Text>
            <Text color={theme.text}>{'•'.repeat(buf.length)}</Text>
            <Text inverse> </Text>
          </Text>
        </Box>
      ) : mode === 'paste' ? (
        <Box marginTop={1} flexDirection="column">
          <Text color={theme.dim}>abra a URL, autorize e cole o code aqui + Enter:</Text>
          <Text color={theme.subtle}>{pasteUrl}</Text>
          <Text>
            <Text color={theme.kapi}>❯ </Text>
            <Text color={theme.text}>{'•'.repeat(buf.length)}</Text>
            <Text inverse> </Text>
          </Text>
        </Box>
      ) : (
        <Box marginTop={1}>
          <Text color={theme.subtle}>
            ↑↓ navega · Enter key{provider.oauth ? ' · o OAuth' : ''} · d desconecta · Esc fecha
          </Text>
        </Box>
      )}
      {flash && (
        <Box marginTop={1}>
          <Text color={theme.successBright}>✓ {flash}</Text>
        </Box>
      )}
    </Box>
  )
}
