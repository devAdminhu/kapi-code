// Registro de providers multi-LLM. Cada modelo (models.ts) aponta pra um
// provider daqui, que diz a URL, o formato do wire (openai-compat ou anthropic)
// e como autenticar (key colada ou OAuth). Azure segue como default histórico.

import { API_URL, ZAI_URL } from './config.js'

export type ProviderId =
  | 'azure'
  | 'anthropic'
  | 'openai'
  | 'google'
  | 'zai'
  | 'openrouter'
  | 'groq'

// formato do corpo/stream: a maioria é OpenAI-compatible; só Anthropic usa
// /v1/messages com eventos próprios (adaptado no client).
export type WireFormat = 'openai' | 'anthropic'

// como mandar a credencial no header
export type AuthHeader = 'bearer' | 'x-api-key'

export type OAuthConfig = {
  clientId: string
  authorizeUrl: string
  tokenUrl: string
  // 'localhost' = sobe servidor de callback local · 'paste' = usuário cola o code
  mode: 'localhost' | 'paste'
  redirectUri: string
  scopes: string
  // params extras no authorize (ex: codex)
  extraAuthParams?: Record<string, string>
  // OpenAI/codex: troca o id_token por uma api-key via token-exchange
  exchangeToApiKey?: boolean
  // formato do corpo no token endpoint: codex usa form-urlencoded, anthropic JSON
  tokenFormat: 'json' | 'form'
}

export type Provider = {
  id: ProviderId
  name: string
  url: string
  format: WireFormat
  authHeader: AuthHeader
  // 'key' = só API key · 'oauth' = só OAuth · 'both' = aceita os dois
  authType: 'key' | 'oauth' | 'both'
  envVar?: string // env var de fallback (retrocompat)
  oauth?: OAuthConfig
}

export const PROVIDERS: Record<ProviderId, Provider> = {
  azure: {
    id: 'azure',
    name: 'Azure (OpenAI-compat)',
    url: API_URL,
    format: 'openai',
    authHeader: 'bearer',
    authType: 'key',
    envVar: 'KAPI_API_KEY',
  },
  anthropic: {
    id: 'anthropic',
    name: 'Anthropic (Claude)',
    url: 'https://api.anthropic.com/v1/messages',
    format: 'anthropic',
    authHeader: 'x-api-key',
    authType: 'both',
    envVar: 'ANTHROPIC_API_KEY',
    oauth: {
      clientId: '9d1c250a-e61b-44d9-88ed-5944d1962f5e',
      authorizeUrl: 'https://claude.ai/oauth/authorize',
      tokenUrl: 'https://console.anthropic.com/v1/oauth/token',
      mode: 'paste',
      redirectUri: 'https://console.anthropic.com/oauth/code/callback',
      scopes: 'org:create_api_key user:profile user:inference',
      tokenFormat: 'json',
    },
  },
  openai: {
    id: 'openai',
    name: 'OpenAI',
    url: 'https://api.openai.com/v1/chat/completions',
    format: 'openai',
    authHeader: 'bearer',
    authType: 'both',
    envVar: 'OPENAI_API_KEY',
    oauth: {
      clientId: process.env.KAPI_OPENAI_CLIENT_ID ?? 'app_EMoamEEZ73f0CkXaXp7hrann',
      authorizeUrl: 'https://auth.openai.com/oauth/authorize',
      tokenUrl: 'https://auth.openai.com/oauth/token',
      mode: 'localhost',
      redirectUri: 'http://localhost:1455/auth/callback',
      scopes: 'openid profile email offline_access api.connectors.read api.connectors.invoke',
      extraAuthParams: { id_token_add_organizations: 'true', codex_cli_simplified_flow: 'true' },
      exchangeToApiKey: true,
      tokenFormat: 'form',
    },
  },
  google: {
    id: 'google',
    name: 'Google Gemini',
    url: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
    format: 'openai',
    authHeader: 'bearer',
    authType: 'both',
    envVar: 'GEMINI_API_KEY',
  },
  zai: {
    id: 'zai',
    name: 'z.ai (GLM)',
    url: ZAI_URL,
    format: 'openai',
    authHeader: 'bearer',
    authType: 'key',
    envVar: 'ZAI_API_KEY',
  },
  openrouter: {
    id: 'openrouter',
    name: 'OpenRouter',
    url: 'https://openrouter.ai/api/v1/chat/completions',
    format: 'openai',
    authHeader: 'bearer',
    authType: 'key',
    envVar: 'OPENROUTER_API_KEY',
  },
  groq: {
    id: 'groq',
    name: 'Groq',
    url: 'https://api.groq.com/openai/v1/chat/completions',
    format: 'openai',
    authHeader: 'bearer',
    authType: 'key',
    envVar: 'GROQ_API_KEY',
  },
}

export const providerOf = (id: ProviderId): Provider => PROVIDERS[id]

export const ALL_PROVIDERS: Provider[] = Object.values(PROVIDERS)
