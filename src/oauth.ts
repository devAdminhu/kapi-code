// Fluxo OAuth PKCE pros providers que suportam login por assinatura:
// - OpenAI/codex (ChatGPT): callback em localhost:1455, troca id_token por api-key
// - Anthropic (Claude Pro/Max): usuário cola o code (redirect no console)
// Salva o resultado no auth store. NÃO testável sem o browser do usuário.

import { createServer } from 'node:http'
import { randomBytes, createHash } from 'node:crypto'
import { spawn } from 'node:child_process'
import type { Provider, OAuthConfig } from './providers.js'
import { setCredential } from './auth.js'

type Pkce = { verifier: string; challenge: string }

const b64url = (b: Buffer): string =>
  b.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

export const generatePkce = (): Pkce => {
  const verifier = b64url(randomBytes(48))
  const challenge = b64url(createHash('sha256').update(verifier).digest())
  return { verifier, challenge }
}

export const randomState = (): string => b64url(randomBytes(24))

export const buildAuthorizeUrl = (oauth: OAuthConfig, pkce: Pkce, state: string): string => {
  const p = new URLSearchParams({
    response_type: 'code',
    client_id: oauth.clientId,
    redirect_uri: oauth.redirectUri,
    scope: oauth.scopes,
    code_challenge: pkce.challenge,
    code_challenge_method: 'S256',
    state,
    ...(oauth.extraAuthParams ?? {}),
  })
  return `${oauth.authorizeUrl}?${p.toString()}`
}

export const openBrowser = (url: string): void => {
  const cmd =
    process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open'
  try {
    spawn(cmd, [url], { stdio: 'ignore', detached: true }).unref()
  } catch {
    /* sem browser: o usuário abre na mão pela URL mostrada */
  }
}

// monta o corpo do token endpoint no formato que o provider exige
const tokenBody = (oauth: OAuthConfig, fields: Record<string, string>): { headers: Record<string, string>; body: string } =>
  oauth.tokenFormat === 'form'
    ? { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(fields).toString() }
    : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(fields) }

// troca o authorization code por tokens
const exchangeCode = async (
  oauth: OAuthConfig,
  code: string,
  verifier: string,
  state?: string,
): Promise<Record<string, unknown>> => {
  const fields: Record<string, string> = {
    grant_type: 'authorization_code',
    code,
    redirect_uri: oauth.redirectUri,
    client_id: oauth.clientId,
    code_verifier: verifier,
  }
  // Anthropic exige o state de volta no token exchange (senão HTTP 400
  // "Invalid request format"); o code vem como code#state.
  if (state) fields.state = state
  const { headers, body } = tokenBody(oauth, fields)
  const res = await fetch(oauth.tokenUrl, { method: 'POST', headers, body })
  if (!res.ok) throw new Error(`token exchange falhou: HTTP ${res.status} — ${(await res.text()).slice(0, 200)}`)
  return (await res.json()) as Record<string, unknown>
}

// OpenAI/codex: troca o id_token por uma openai-api-key (form-urlencoded)
const exchangeForApiKey = async (oauth: OAuthConfig, idToken: string): Promise<string> => {
  const { headers, body } = tokenBody(oauth, {
    grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange',
    client_id: oauth.clientId,
    requested_token: 'openai-api-key',
    subject_token: idToken,
    subject_token_type: 'urn:ietf:params:oauth:token-type:id_token',
  })
  const res = await fetch(oauth.tokenUrl, { method: 'POST', headers, body })
  if (!res.ok) throw new Error(`token-exchange (api-key) falhou: HTTP ${res.status}`)
  const j = (await res.json()) as { access_token?: string }
  if (!j.access_token) throw new Error('token-exchange não retornou api-key')
  return j.access_token
}

// persiste o resultado: api-key (codex) ou access/refresh token (anthropic)
const persist = async (provider: Provider, oauth: OAuthConfig, tokens: Record<string, unknown>): Promise<void> => {
  if (oauth.exchangeToApiKey && typeof tokens.id_token === 'string') {
    // conta com direito a API mint → vira api-key. Plano ChatGPT puro dá 401:
    // nesse caso guardamos o access_token (usado no backend ChatGPT/responses).
    try {
      const key = await exchangeForApiKey(oauth, tokens.id_token)
      setCredential(provider.id, { type: 'api', key })
      return
    } catch {
      /* sem direito a api-key: cai pro access_token oauth abaixo */
    }
  }
  const access = tokens.access_token as string | undefined
  if (!access) throw new Error('login não retornou access_token')
  const refresh = tokens.refresh_token as string | undefined
  const expiresIn = tokens.expires_in as number | undefined
  setCredential(provider.id, {
    type: 'oauth',
    access,
    refresh,
    expires: expiresIn ? Date.now() + expiresIn * 1000 : undefined,
  })
}

/**
 * Login via callback localhost (OpenAI/codex). Abre o browser, espera o redirect,
 * troca o code e salva. Resolve quando conectado; rejeita em erro/timeout.
 */
export const loginLocalhost = (provider: Provider, oauth: OAuthConfig): Promise<void> => {
  const pkce = generatePkce()
  const state = randomState()
  const port = Number(new URL(oauth.redirectUri).port || 80)
  const path = new URL(oauth.redirectUri).pathname

  return new Promise<void>((resolve, reject) => {
    const server = createServer((req, res) => {
      const url = new URL(req.url ?? '/', `http://localhost:${port}`)
      if (url.pathname !== path) {
        res.writeHead(404).end()
        return
      }
      const code = url.searchParams.get('code')
      const gotState = url.searchParams.get('state')
      res.writeHead(200, { 'Content-Type': 'text/html' }).end(
        '<html><body style="font-family:sans-serif;background:#0a0a0a;color:#22d3ee"><h2>Kapi: login concluído. Pode fechar esta aba.</h2></body></html>',
      )
      server.close()
      if (!code || gotState !== state) {
        reject(new Error('callback sem code válido ou state divergente'))
        return
      }
      exchangeCode(oauth, code, pkce.verifier, gotState ?? undefined)
        .then(t => persist(provider, oauth, t))
        .then(resolve)
        .catch(reject)
    })
    server.on('error', reject)
    server.listen(port, () => openBrowser(buildAuthorizeUrl(oauth, pkce, state)))
    setTimeout(() => {
      server.close()
      reject(new Error('login expirou (5 min)'))
    }, 300_000).unref()
  })
}

/**
 * Login por colar code (Anthropic). Devolve a URL pra abrir e um finalizador
 * que recebe o code colado (formato code#state ou só code) e salva.
 */
export const loginPasteStart = (
  oauth: OAuthConfig,
): { url: string; finish: (pasted: string, provider: Provider) => Promise<void> } => {
  const pkce = generatePkce()
  const state = randomState()
  const url = buildAuthorizeUrl(oauth, pkce, state)
  openBrowser(url)
  const finish = async (pasted: string, provider: Provider): Promise<void> => {
    const [rawCode, rawState] = pasted.split('#')
    const code = rawCode!.trim()
    // se o usuário colou só o code, usa o state que geramos no authorize
    const st = rawState?.trim() || state
    const tokens = await exchangeCode(oauth, code, pkce.verifier, st)
    await persist(provider, oauth, tokens)
  }
  return { url, finish }
}
