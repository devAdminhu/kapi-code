// WebFetch fiel ao do Claude Code: baixa a página e converte o HTML em
// MARKDOWN limpo (preserva títulos, links, listas, parágrafos, código e tabelas;
// descarta script/style/nav/svg/comentários). Sem dependência de browser.

const UA =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36'

const decodeEntities = (s: string): string =>
  s
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&hellip;/g, '…')
    .replace(/&mdash;/g, '—')
    .replace(/&ndash;/g, '–')
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h: string) => String.fromCodePoint(parseInt(h, 16)))

// extrai href de uma tag de abertura <a ...>
const hrefOf = (tag: string): string => {
  const m = tag.match(/href\s*=\s*["']([^"']+)["']/i)
  return m?.[1] ?? ''
}

/**
 * Converte HTML em Markdown. Estratégia em passes (ordem importa):
 *  1. remove blocos não-conteúdo (script/style/nav/head/svg/comentário)
 *  2. isola o conteúdo principal (<main>/<article>) se existir
 *  3. mapeia tags estruturais → markdown (h1-6, li, a, code, pre, br, p…)
 *  4. tira o resto das tags, decodifica entidades e normaliza espaços
 */
export const htmlToMarkdown = (html: string): string => {
  let s = html

  // 1) fora tudo que não é conteúdo
  s = s
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, '')
    .replace(/<svg[\s\S]*?<\/svg>/gi, '')
    .replace(/<head[\s\S]*?<\/head>/gi, '')
    .replace(/<(nav|footer|header|aside|form)\b[\s\S]*?<\/\1>/gi, '')

  // 2) foca no conteúdo principal, se a página marcar
  const main = s.match(/<(?:main|article)\b[^>]*>([\s\S]*?)<\/(?:main|article)>/i)
  if (main?.[1] && main[1].length > 200) s = main[1]

  // 3) títulos
  s = s.replace(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi, (_, lvl: string, inner: string) => {
    const hashes = '#'.repeat(Number(lvl))
    return `\n\n${hashes} ${inner.replace(/<[^>]+>/g, '').trim()}\n\n`
  })

  // listas
  s = s.replace(/<li\b[^>]*>([\s\S]*?)<\/li>/gi, (_, inner: string) => `\n- ${inner.trim()}`)
  s = s.replace(/<\/(ul|ol)>/gi, '\n')

  // blocos de código
  s = s.replace(/<pre\b[^>]*>([\s\S]*?)<\/pre>/gi, (_, inner: string) => {
    const code = inner.replace(/<[^>]+>/g, '')
    return `\n\n\`\`\`\n${decodeEntities(code).trim()}\n\`\`\`\n\n`
  })
  s = s.replace(/<code\b[^>]*>([\s\S]*?)<\/code>/gi, (_, inner: string) => `\`${inner.replace(/<[^>]+>/g, '')}\``)

  // links → [texto](url)
  s = s.replace(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi, (_, attrs: string, inner: string) => {
    const text = inner.replace(/<[^>]+>/g, '').trim()
    const href = hrefOf(`<a ${attrs}>`)
    if (!text) return ''
    return href && /^https?:/i.test(href) ? `[${text}](${href})` : text
  })

  // ênfase
  s = s.replace(/<(strong|b)\b[^>]*>([\s\S]*?)<\/\1>/gi, (_, _t: string, inner: string) => `**${inner.replace(/<[^>]+>/g, '')}**`)
  s = s.replace(/<(em|i)\b[^>]*>([\s\S]*?)<\/\1>/gi, (_, _t: string, inner: string) => `*${inner.replace(/<[^>]+>/g, '')}*`)

  // quebras de bloco
  s = s.replace(/<br\s*\/?>/gi, '\n')
  s = s.replace(/<\/(p|div|section|tr|h[1-6]|blockquote)>/gi, '\n\n')
  s = s.replace(/<th\b[^>]*>([\s\S]*?)<\/th>/gi, (_, i: string) => `${i.replace(/<[^>]+>/g, '').trim()} | `)
  s = s.replace(/<td\b[^>]*>([\s\S]*?)<\/td>/gi, (_, i: string) => `${i.replace(/<[^>]+>/g, '').trim()} | `)

  // 4) tira tags restantes, decodifica, normaliza
  s = s.replace(/<[^>]+>/g, ' ')
  s = decodeEntities(s)
  s = s
    .replace(/[ \t]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()

  return s
}

export type FetchResult = { url: string; title: string; markdown: string; truncated: boolean }

/** Baixa a URL e devolve markdown limpo (até `maxChars`). Segue redirects. */
export const webFetch = async (url: string, maxChars = 12_000): Promise<FetchResult> => {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), 25_000)
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml,*/*' },
      redirect: 'follow',
      signal: ctrl.signal,
    })
    const finalUrl = res.url || url
    const ct = res.headers.get('content-type') ?? ''
    const raw = (await res.text()).slice(0, 600_000)

    // não-HTML (JSON, txt): devolve cru
    if (!/text\/html|xml|xhtml/i.test(ct) && !/^\s*<(!doctype|html)/i.test(raw)) {
      const body = raw.trim()
      return {
        url: finalUrl,
        title: '',
        markdown: body.slice(0, maxChars),
        truncated: body.length > maxChars,
      }
    }

    const titleMatch = raw.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)
    const title = titleMatch?.[1] ? decodeEntities(titleMatch[1].replace(/<[^>]+>/g, '').trim()) : ''
    const md = htmlToMarkdown(raw)
    return {
      url: finalUrl,
      title,
      markdown: md.slice(0, maxChars),
      truncated: md.length > maxChars,
    }
  } finally {
    clearTimeout(t)
  }
}

// ── busca web (Google News RSS — XML estável, sem captcha, sem chave) ──
export type SearchHit = { title: string; url: string; snippet: string; source?: string }

const tag = (xml: string, name: string): string => {
  const m = xml.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)<\\/${name}>`, 'i'))
  let v = m?.[1] ?? ''
  v = v.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
  return decodeEntities(v.replace(/<[^>]+>/g, '').trim())
}

const hostOf = (u: string): string => {
  try {
    return new URL(u).hostname.replace(/^www\./, '')
  } catch {
    return ''
  }
}

// DDG embrulha o link em /l/?uddg=<url-encoded> — desembrulha pro link limpo.
const unwrapDdg = (href: string): string => {
  const m = href.match(/[?&]uddg=([^&]+)/)
  if (m?.[1]) {
    try {
      return decodeURIComponent(m[1])
    } catch {
      /* mantém o original */
    }
  }
  return href.startsWith('//') ? `https:${href}` : href
}

// Notícias (Google News RSS) — fallback e bom pra "últimas notícias sobre X".
const newsSearch = async (query: string, limit: number, signal: AbortSignal): Promise<SearchHit[]> => {
  const url =
    'https://news.google.com/rss/search?' +
    new URLSearchParams({ q: query, hl: 'pt-BR', gl: 'BR', ceid: 'BR:pt-419' }).toString()
  const res = await fetch(url, { headers: { 'User-Agent': UA }, signal })
  const xml = await res.text()
  const hits: SearchHit[] = []
  for (const raw of xml.split(/<item>/i).slice(1)) {
    if (hits.length >= limit) break
    const item = raw.split(/<\/item>/i)[0] ?? ''
    const title = tag(item, 'title')
    const link = tag(item, 'link')
    if (title && link) hits.push({ title, url: link, snippet: tag(item, 'pubDate'), source: tag(item, 'source') })
  }
  return hits
}

/**
 * Busca web via DuckDuckGo (HTML), com URL/título/snippet limpos. Cai pro
 * Google News RSS se o DDG vier vazio (bot-block etc.).
 */
export const webSearch = async (query: string, limit = 8): Promise<SearchHit[]> => {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), 20_000)
  try {
    const res = await fetch('https://html.duckduckgo.com/html/', {
      method: 'POST',
      headers: { 'User-Agent': UA, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ q: query, kl: 'br-pt' }).toString(),
      signal: ctrl.signal,
    })
    const html = await res.text()

    const hits: SearchHit[] = []
    // cada resultado: <a class="result__a" href="...">título</a> + result__snippet
    const re =
      /<a[^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?(?:<a[^>]*class="result__snippet"[^>]*>([\s\S]*?)<\/a>)?/gi
    let m: RegExpExecArray | null
    while ((m = re.exec(html)) && hits.length < limit) {
      const url = unwrapDdg(m[1] ?? '')
      const title = decodeEntities((m[2] ?? '').replace(/<[^>]+>/g, '').trim())
      const snippet = decodeEntities((m[3] ?? '').replace(/<[^>]+>/g, '').trim())
      if (title && url.startsWith('http')) hits.push({ title, url, snippet, source: hostOf(url) })
    }
    if (hits.length) return hits
    return await newsSearch(query, limit, ctrl.signal)
  } catch {
    return await newsSearch(query, limit, ctrl.signal).catch(() => [])
  } finally {
    clearTimeout(t)
  }
}
