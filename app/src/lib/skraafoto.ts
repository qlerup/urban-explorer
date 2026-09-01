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

// Midlertidig diagnostik: viser hvilket host der blev afvist, så vi kan finde det
// rigtige domæne Dataforsyningen faktisk bruger til COG-filerne uden serveradgang.
export function describeRejectedUrl(raw: string | null): string {
  if (!raw) return 'ingen url angivet'
  try {
    const url = new URL(raw)
    return `host: ${url.hostname}, protokol: ${url.protocol}`
  } catch {
    return `kunne ikke parses: ${raw}`
  }
}
