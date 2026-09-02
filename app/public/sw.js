const APP_CACHE = 'urban-explorer-app-shell-v5'
const APP_CACHE_PREFIX = 'urban-explorer-app-shell-'
const OFFLINE_MAP_CACHE_PREFIX = 'urban-explorer-offline-map-'

self.addEventListener('install', event => {
  event.waitUntil(self.skipWaiting())
})

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const names = await caches.keys()
    await Promise.all(names
      .filter(name => name.startsWith(APP_CACHE_PREFIX) && name !== APP_CACHE)
      .map(name => caches.delete(name)))
    await self.clients.claim()
  })())
})

async function cacheOne(cache, rawUrl) {
  const url = new URL(rawUrl, self.location.origin)
  if (url.origin !== self.location.origin) return
  const response = await fetch(new Request(url.toString(), { credentials: 'include', cache: 'reload' }))
  if (!response.ok) return
  await cache.put(url.toString(), response.clone())

  const contentType = response.headers.get('content-type') || ''
  if (!contentType.includes('text/html')) return

  const html = await response.text()
  const assetMatches = html.matchAll(/(?:src|href)=["'](\/_next\/static\/[^"']+)["']/g)
  const assets = [...new Set(Array.from(assetMatches, match => match[1]))]
  for (const asset of assets) {
    try {
      const assetUrl = new URL(asset, self.location.origin).toString()
      const assetResponse = await fetch(new Request(assetUrl, { credentials: 'include', cache: 'reload' }))
      if (assetResponse.ok) await cache.put(assetUrl, assetResponse.clone())
    } catch {
      // En manglende chunk må ikke stoppe resten af app-shell'en.
    }
  }
}

async function cacheShellUrls(urls) {
  const cache = await caches.open(APP_CACHE)
  const requiredUrls = [...new Set(['/dashboard/kort', '/dashboard/ruteplanlaegger', ...urls])]
  for (const rawUrl of requiredUrls) {
    try {
      await cacheOne(cache, rawUrl)
    } catch {
      // En enkelt ressource må ikke forhindre resten af app-shell'en i at blive gemt.
    }
  }
}

self.addEventListener('message', event => {
  const data = event.data
  if (!data || data.type !== 'CACHE_APP_SHELL' || !Array.isArray(data.urls)) return
  event.waitUntil(cacheShellUrls(data.urls))
})

async function findOfflineMapResponse(request) {
  const names = await caches.keys()
  const offlineCaches = names.filter(name => name.startsWith(OFFLINE_MAP_CACHE_PREFIX))
  for (const name of offlineCaches) {
    const cache = await caches.open(name)
    const response = await cache.match(request, { ignoreVary: true })
    if (response) return response
  }
  return null
}

async function navigationResponse(request) {
  const cache = await caches.open(APP_CACHE)
  const url = new URL(request.url)
  const canonicalUrl = new URL(url.pathname, self.location.origin).toString()

  try {
    const network = await fetch(request)
    if (network.ok && (url.pathname === '/dashboard/kort' || url.pathname === '/dashboard/ruteplanlaegger')) {
      await cache.put(canonicalUrl, network.clone())
    }
    return network
  } catch {
    return (await cache.match(canonicalUrl, { ignoreVary: true }))
      || (await cache.match(request, { ignoreVary: true }))
      || (await cache.match(new URL('/dashboard/kort', self.location.origin).toString(), { ignoreVary: true }))
      || new Response('Urban Explorer er offline, og kortsiden er ikke gemt på denne enhed endnu.', {
        status: 503,
        headers: { 'Content-Type': 'text/plain; charset=utf-8' },
      })
  }
}

async function staticResponse(request) {
  const cache = await caches.open(APP_CACHE)
  const cached = await cache.match(request, { ignoreVary: true })
  if (cached) return cached
  try {
    const network = await fetch(request)
    if (network.ok) await cache.put(request, network.clone())
    return network
  } catch {
    return (await findOfflineMapResponse(request)) || Response.error()
  }
}

async function offlineAreaResponse(request) {
  try {
    const network = await fetch(request)
    if (network.ok) return network
    return network
  } catch {
    return (await findOfflineMapResponse(request)) || new Response(null, { status: 504 })
  }
}

self.addEventListener('fetch', event => {
  const request = event.request
  if (request.method !== 'GET') return
  const url = new URL(request.url)

  if (request.mode === 'navigate') {
    event.respondWith(navigationResponse(request))
    return
  }

  if (url.origin !== self.location.origin) return

  if (url.pathname.startsWith('/api/map-tiles/geodanmark/')) {
    event.respondWith(offlineAreaResponse(request))
    return
  }

  if (url.pathname.startsWith('/api/pins/') && url.pathname.includes('/images/')) {
    event.respondWith(offlineAreaResponse(request))
    return
  }

  if (
    url.pathname.startsWith('/_next/static/')
    || url.pathname.startsWith('/pin-icons/')
    || url.pathname === '/site.webmanifest'
    || /\.(?:css|js|woff2?|png|jpg|jpeg|svg|ico)$/i.test(url.pathname)
  ) {
    event.respondWith(staticResponse(request))
  }
})
