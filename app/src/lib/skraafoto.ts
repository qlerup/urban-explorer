const ALLOWED_HOSTS = new Set(['cdn.dataforsyningen.dk', 'api.dataforsyningen.dk'])

// Skråfoto-tile/info/thumbnail-routes modtager en klient-leveret upstream-URL
// (den specifikke foto-fil), som skal whitelist-tjekkes før den sendes videre
// server-side - ellers bliver routen et åbent SSRF-proxy.
export function parseAllowedDataforsyningenUrl(raw: string | null): URL | null {
  if (!raw) return null
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return null
  }
  if (url.protocol !== 'https:' || !ALLOWED_HOSTS.has(url.hostname)) return null
  return url
}
