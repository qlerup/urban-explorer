const ALLOWED_HOSTS = new Set(['skraafoto-cdn.dataforsyningen.dk', 'cdn.dataforsyningen.dk', 'api.dataforsyningen.dk'])

// Base64url i stedet for en rå, læsbar URL i query-strengen - nogle Cloudflare/WAF-
// opsætninger blokerer automatisk requests hvor en query-parameter selv indeholder
// "http(s)://" (ligner et SSRF-/redirect-forsøg), uanset at destinationen er harmløs.
function toBase64Url(value: string): string {
  const base64 = typeof window === 'undefined'
    ? Buffer.from(value, 'utf-8').toString('base64')
    : btoa(unescape(encodeURIComponent(value)))
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function fromBase64Url(value: string): string | null {
  try {
    const base64 = value.replace(/-/g, '+').replace(/_/g, '/')
    const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4)
    return typeof window === 'undefined'
      ? Buffer.from(padded, 'base64').toString('utf-8')
      : decodeURIComponent(escape(atob(padded)))
  } catch {
    return null
  }
}

// Bruges klient-side til at bygge URL'en til /api/skraafoto/{info,tiles,thumbnail}.
export function encodeUpstreamUrl(url: string): string {
  return toBase64Url(url)
}

// Skråfoto-tile/info/thumbnail-routes modtager en klient-leveret upstream-URL
// (den specifikke foto-fil), som skal whitelist-tjekkes før den sendes videre
// server-side - ellers bliver routen et åbent SSRF-proxy.
export function parseAllowedDataforsyningenUrl(raw: string | null): URL | null {
  if (!raw) return null
  const decoded = fromBase64Url(raw)
  if (!decoded) return null
  let url: URL
  try {
    url = new URL(decoded)
  } catch {
    return null
  }
  if (url.protocol !== 'https:' || !ALLOWED_HOSTS.has(url.hostname)) return null
  return url
}
