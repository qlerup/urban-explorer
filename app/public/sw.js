const APP_CACHE = 'urban-explorer-app-shell-v1'
const APP_CACHE_PREFIX = 'urban-explorer-app-shell-'
const OFFLINE_MAP_CACHE_PREFIX = 'urban-explorer-offline-map-'

self.addEventListener('install', event => {
  self.skipWaiting()
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

async function cacheShellUrls(urls) {
  const cache = await caches.open(APP_CACHE)
  for (const rawUrl of urls) {
    try {
      const url = new URL(rawUrl, self.location.origin)
      if (url.origin !== self.location.origin) continue
      const response = await fetch(new Request(url.toString(), { credentials: 'include', cache: 'reload' }))
      if (response.ok) await cache.put(url.toString(), response.clone())
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
  try {
    const network = await fetch(request)
    if (network.ok) {
      const cache = await caches.open(APP_CACHE)
      const url = new URL(request.url)
      if (url.pathname === '/dashboard/kort') {
        await cache.put(new URL('/dashboard/kort', self.location.origin).toString(), network.clone())
      }
    }
    return network
  } catch {
    const cache = await caches.open(APP_CACHE)
    return (await cache.match(new URL('/dashboard/kort', self.location.origin).toString()))
      || (await cache.match(request))
      || new Response('Urban Explorer er offline, og kortsiden er ikke gemt på denne enhed endnu.', {
        status: 503,
        headers: { 'Content-Type': 'text/plain; charset=utf-8' },
      })
  }
}

async function staticResponse(request) {
  const cache = await caches.open(APP_CACHE)
  const cached = await cache.match(request)
  if (cached) return cached
  try {
    const network = await fetch(request)
    if (network.ok) await cache.put(request, network.clone())
    return network
  } catch {
    return cached || Response.error()
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
    event.respondWith((async () => {
      try {
        const network = await fetch(request)
        if (network.ok) return network
      } catch {
        // Brug lokalt kort nedenfor.
      }
      return (await findOfflineMapResponse(request)) || new Response(null, { status: 504 })
    })())
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
