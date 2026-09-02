'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import type * as Leaflet from 'leaflet'
import type { Category, Pin } from '@/types/pin'
import {
  OFFLINE_BUFFER_KM,
  OFFLINE_MAX_TILES,
  OFFLINE_MIN_ZOOM,
  OFFLINE_QUALITY,
  areaCacheName,
  bufferBounds,
  deleteOfflineArea,
  formatOfflineBytes,
  getActiveOfflineAreaId,
  jsonByteSize,
  listOfflineAreas,
  pointInBounds,
  saveOfflineArea,
  setActiveOfflineAreaId,
  tilesForBounds,
  type OfflineBounds,
  type OfflineMapArea,
  type OfflineMapQuality,
  type OfflineSavedRoute,
} from '@/lib/offlineMaps'

interface Props {
  initialPins: Pin[]
  categories: Category[]
  geodanmarkAvailable: boolean
}

type BrowserWindow = Window & {
  __urbanExplorerLeafletMap?: Leaflet.Map
}

interface SavedRouteSummary {
  id: string
  name: string
}

interface DownloadProgress {
  done: number
  total: number
  bytes: number
}

interface OfflineRouteCheck {
  route: OfflineSavedRoute
  stopCount: number
  outsideStops: string[]
}

const FALLBACK_TILE_BYTES = 85_000
const DOWNLOAD_CONCURRENCY = 6

function normalizeBounds(a: Leaflet.LatLng, b: Leaflet.LatLng): OfflineBounds {
  return {
    south: Math.min(a.lat, b.lat),
    west: Math.min(a.lng, b.lng),
    north: Math.max(a.lat, b.lat),
    east: Math.max(a.lng, b.lng),
  }
}

function decodePolyline6(encoded: string): [number, number][] {
  const coordinates: [number, number][] = []
  let index = 0
  let lat = 0
  let lng = 0

  const decodeValue = () => {
    let result = 0
    let shift = 0
    let byte = 0
    do {
      byte = encoded.charCodeAt(index++) - 63
      result |= (byte & 0x1f) << shift
      shift += 5
    } while (byte >= 0x20 && index <= encoded.length)
    return (result & 1) ? ~(result >> 1) : (result >> 1)
  }

  while (index < encoded.length) {
    lat += decodeValue()
    lng += decodeValue()
    coordinates.push([lat / 1e6, lng / 1e6])
  }
  return coordinates
}

function routeTouchesBounds(route: OfflineSavedRoute, bounds: OfflineBounds): boolean {
  const coords = Object.values(route.routeData.stopCoordinates ?? {})
  if (coords.some(point => pointInBounds(point.lat, point.lng, bounds))) return true

  for (const shape of route.routeData.shapes ?? []) {
    const points = decodePolyline6(shape)
    if (points.some(([lat, lng]) => pointInBounds(lat, lng, bounds))) return true
  }
  return false
}

function inspectRouteStops(route: OfflineSavedRoute, bounds: OfflineBounds, pins: Pin[]): OfflineRouteCheck {
  const coordinates = route.routeData.stopCoordinates ?? {}
  const orderedIds = route.routeData.orderedStopIds ?? []
  const stopIds = [...new Set([...orderedIds, ...Object.keys(coordinates)])]
  const pinNames = new Map(pins.map(pin => [pin.id, pin.name]))

  const outsideStops = stopIds.flatMap(id => {
    const point = coordinates[id]
    if (!point || pointInBounds(point.lat, point.lng, bounds)) return []
    return [route.routeData.stopLabels?.[id] || pinNames.get(id) || 'Ukendt stop']
  })

  return {
    route,
    stopCount: stopIds.length,
    outsideStops: [...new Set(outsideStops)],
  }
}

function defaultAreaName(): string {
  return `Offlineområde ${new Date().toLocaleDateString('da-DK')}`
}

function areaSquareKm(bounds: OfflineBounds): number {
  const midLat = (bounds.south + bounds.north) / 2
  const height = Math.abs(bounds.north - bounds.south) * 111.32
  const width = Math.abs(bounds.east - bounds.west) * 111.32 * Math.cos((midLat * Math.PI) / 180)
  return Math.max(0, width * height)
}

function tileUrl(z: number, x: number, y: number): string {
  return `/api/map-tiles/geodanmark/${z}/${x}/${y}`
}

function currentShellUrls(): string[] {
  const urls = new Set<string>([
    '/dashboard/kort',
    '/dashboard/ruteplanlaegger',
    '/site.webmanifest',
    '/favicon.ico',
    '/android-chrome-192x192.png',
    '/android-chrome-512x512.png',
    '/apple-touch-icon.png',
  ])
  document.querySelectorAll<HTMLScriptElement>('script[src]').forEach(element => {
    if (element.src.startsWith(window.location.origin)) urls.add(new URL(element.src).pathname)
  })
  document.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"][href]').forEach(element => {
    if (element.href.startsWith(window.location.origin)) urls.add(new URL(element.href).pathname)
  })
  return [...urls]
}

async function askServiceWorkerToCacheShell(): Promise<void> {
  if (!('serviceWorker' in navigator)) return
  try {
    const registration = await navigator.serviceWorker.ready
    const worker = registration.active ?? registration.waiting ?? registration.installing
    worker?.postMessage({ type: 'CACHE_APP_SHELL', urls: currentShellUrls() })
  } catch {
    // Kortpakken virker stadig i den aktuelle session; offline koldstart kan blot ikke garanteres.
  }
}

export default function OfflineMapManager({ initialPins, categories, geodanmarkAvailable }: Props) {
  const [areas, setAreas] = useState<OfflineMapArea[]>([])
  const [activeAreaId, setActiveAreaIdState] = useState<string | null>(null)
  const [showList, setShowList] = useState(false)
  const [showConfigure, setShowConfigure] = useState(false)
  const [selecting, setSelecting] = useState(false)
  const [selectionStep, setSelectionStep] = useState<0 | 1>(0)
  const [selectedBounds, setSelectedBounds] = useState<OfflineBounds | null>(null)
  const [quality, setQuality] = useState<OfflineMapQuality>('standard')
  const [areaName, setAreaName] = useState(defaultAreaName)
  const [sourcePins, setSourcePins] = useState<Pin[]>(initialPins)
  const [routes, setRoutes] = useState<OfflineSavedRoute[]>([])
  const [routesLoading, setRoutesLoading] = useState(false)
  const [averageTileBytes, setAverageTileBytes] = useState(FALLBACK_TILE_BYTES)
  const [estimating, setEstimating] = useState(false)
  const [downloading, setDownloading] = useState(false)
  const [downloadProgress, setDownloadProgress] = useState<DownloadProgress | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [online, setOnline] = useState(true)
  const [mapVersion, setMapVersion] = useState(0)
  const firstCornerRef = useRef<Leaflet.LatLng | null>(null)
  const selectionLayerRef = useRef<Leaflet.LayerGroup | null>(null)
  const offlineBaseLayerRef = useRef<Leaflet.TileLayer | null>(null)

  async function refreshAreas() {
    try {
      const next = await listOfflineAreas()
      setAreas(next)
      const storedActive = getActiveOfflineAreaId()
      setActiveAreaIdState(storedActive && next.some(area => area.id === storedActive) ? storedActive : null)
    } catch (cause) {
      console.warn('[offline] Offlineområder kunne ikke læses:', cause)
    }
  }

  useEffect(() => {
    setOnline(navigator.onLine)
    void refreshAreas()
    const onOnline = () => setOnline(true)
    const onOffline = () => setOnline(false)
    const onMapReady = () => setMapVersion(previous => previous + 1)
    window.addEventListener('online', onOnline)
    window.addEventListener('offline', onOffline)
    window.addEventListener('urban-explorer-map-ready', onMapReady)
    return () => {
      window.removeEventListener('online', onOnline)
      window.removeEventListener('offline', onOffline)
      window.removeEventListener('urban-explorer-map-ready', onMapReady)
    }
  }, [])

  const downloadBounds = useMemo(
    () => selectedBounds ? bufferBounds(selectedBounds, OFFLINE_BUFFER_KM) : null,
    [selectedBounds]
  )
  const maxZoom = OFFLINE_QUALITY[quality].maxZoom
  const tiles = useMemo(
    () => downloadBounds ? tilesForBounds(downloadBounds, OFFLINE_MIN_ZOOM, maxZoom) : [],
    [downloadBounds, maxZoom]
  )
  const pinsInArea = useMemo(
    () => downloadBounds
      ? sourcePins.filter(pin => pointInBounds(pin.latitude, pin.longitude, downloadBounds))
      : [],
    [downloadBounds, sourcePins]
  )
  const routesInArea = useMemo(
    () => downloadBounds ? routes.filter(route => routeTouchesBounds(route, downloadBounds)) : [],
    [downloadBounds, routes]
  )
  const routeChecks = useMemo(
    () => selectedBounds
      ? routesInArea.map(route => inspectRouteStops(route, selectedBounds, sourcePins))
      : [],
    [routesInArea, selectedBounds, sourcePins]
  )
  const routesWithOutsideStops = routeChecks.filter(check => check.outsideStops.length > 0)
  const pinBytes = useMemo(() => jsonByteSize(pinsInArea), [pinsInArea])
  const routeBytes = useMemo(() => jsonByteSize(routesInArea), [routesInArea])
  const estimatedMapBytes = tiles.length * averageTileBytes
  const estimatedTotalBytes = estimatedMapBytes + pinBytes + routeBytes
  const selectionAreaKm2 = selectedBounds ? areaSquareKm(selectedBounds) : 0
  const tooManyTiles = tiles.length > OFFLINE_MAX_TILES

  useEffect(() => {
    const activeMap = (window as BrowserWindow).__urbanExplorerLeafletMap
    if (!selecting || !activeMap) return

    let disposed = false
    const startSelection = async () => {
      const leafletModule = await import('leaflet')
      if (disposed) return
      const L = (leafletModule as unknown as { default?: typeof Leaflet }).default
        ?? (leafletModule as unknown as typeof Leaflet)

      firstCornerRef.current = null
      setSelectionStep(0)
      selectionLayerRef.current?.remove()
      selectionLayerRef.current = L.layerGroup().addTo(activeMap)
      const container = activeMap.getContainer()
      const oldCursor = container.style.cursor
      container.style.cursor = 'crosshair'

      const handleClick = (event: Leaflet.LeafletMouseEvent) => {
        if (!firstCornerRef.current) {
          firstCornerRef.current = event.latlng
          setSelectionStep(1)
          L.circleMarker(event.latlng, {
            radius: 7,
            color: '#f59e0b',
            weight: 3,
            fillColor: '#111827',
            fillOpacity: 0.9,
          }).addTo(selectionLayerRef.current!)
          return
        }

        const bounds = normalizeBounds(firstCornerRef.current, event.latlng)
        selectionLayerRef.current?.clearLayers()
        L.rectangle(
          [[bounds.south, bounds.west], [bounds.north, bounds.east]],
          { color: '#f59e0b', weight: 3, fillColor: '#f59e0b', fillOpacity: 0.12, dashArray: '8 6' }
        ).addTo(selectionLayerRef.current!)
        setSelectedBounds(bounds)
        setAreaName(defaultAreaName())
        setQuality('standard')
        setError(null)
        setSelecting(false)
        setShowConfigure(true)
      }

      activeMap.on('click', handleClick)
      const cleanup = () => {
        activeMap.off('click', handleClick)
        container.style.cursor = oldCursor
      }
      ;(selectionLayerRef.current as Leaflet.LayerGroup & { __ueCleanup?: () => void }).__ueCleanup = cleanup
    }

    void startSelection()
    return () => {
      disposed = true
      const layer = selectionLayerRef.current as (Leaflet.LayerGroup & { __ueCleanup?: () => void }) | null
      layer?.__ueCleanup?.()
    }
  }, [selecting, mapVersion])

  useEffect(() => {
    if (!showConfigure || !downloadBounds || !online) return
    let cancelled = false

    const loadPackageDataAndEstimate = async () => {
      setRoutesLoading(true)
      setEstimating(true)

      try {
        const pinsResponse = await fetch('/api/pins', { cache: 'no-store' })
        if (pinsResponse.ok) {
          const data = await pinsResponse.json() as { pins?: Pin[] }
          if (!cancelled && Array.isArray(data.pins)) setSourcePins(data.pins)
        }
      } catch {
        // initialPins er fallback, hvis et frisk pin-opslag fejler.
      }

      try {
        const routeResponse = await fetch('/api/route-planner/saved', { cache: 'no-store' })
        if (routeResponse.ok) {
          const routeList = await routeResponse.json() as { routes?: SavedRouteSummary[] }
          const details = await Promise.all((routeList.routes ?? []).map(async summary => {
            const response = await fetch(`/api/route-planner/saved/${encodeURIComponent(summary.id)}`, { cache: 'no-store' })
            if (!response.ok) return null
            return await response.json() as OfflineSavedRoute
          }))
          if (!cancelled) setRoutes(details.filter((route): route is OfflineSavedRoute => Boolean(route)))
        }
      } catch {
        if (!cancelled) setRoutes([])
      } finally {
        if (!cancelled) setRoutesLoading(false)
      }

      try {
        const centerLat = (downloadBounds.south + downloadBounds.north) / 2
        const centerLng = (downloadBounds.west + downloadBounds.east) / 2
        const sampleZooms = [...new Set([Math.max(OFFLINE_MIN_ZOOM, maxZoom - 2), maxZoom])]
        const sampleTiles = sampleZooms.flatMap(z => {
          const nearby = tilesForBounds({
            south: centerLat - 0.0001,
            north: centerLat + 0.0001,
            west: centerLng - 0.0001,
            east: centerLng + 0.0001,
          }, z, z)
          return nearby.slice(0, 1)
        })
        const sizes: number[] = []
        for (const tile of sampleTiles) {
          const response = await fetch(tileUrl(tile.z, tile.x, tile.y), { cache: 'no-store' })
          if (response.ok) sizes.push((await response.blob()).size)
        }
        if (!cancelled && sizes.length > 0) {
          setAverageTileBytes(Math.max(20_000, Math.round(sizes.reduce((sum, size) => sum + size, 0) / sizes.length)))
        }
      } catch {
        if (!cancelled) setAverageTileBytes(FALLBACK_TILE_BYTES)
      } finally {
        if (!cancelled) setEstimating(false)
      }
    }

    void loadPackageDataAndEstimate()
    return () => { cancelled = true }
  }, [showConfigure, downloadBounds, online, maxZoom])

  async function activateArea(area: OfflineMapArea) {
    setActiveOfflineAreaId(area.id)
    setActiveAreaIdState(area.id)
    setShowList(false)
    setError(null)

    const activeMap = (window as BrowserWindow).__urbanExplorerLeafletMap
    if (!activeMap) return
    const leafletModule = await import('leaflet')
    const L = (leafletModule as unknown as { default?: typeof Leaflet }).default
      ?? (leafletModule as unknown as typeof Leaflet)

    activeMap.eachLayer(layer => {
      if (layer instanceof L.TileLayer) activeMap.removeLayer(layer)
    })
    offlineBaseLayerRef.current?.remove()
    offlineBaseLayerRef.current = L.tileLayer('/api/map-tiles/geodanmark/{z}/{x}/{y}', {
      attribution: '&copy; Klimadatastyrelsen / GeoDanmark · Offline',
      tileSize: 256,
      minZoom: area.minZoom,
      maxNativeZoom: area.maxZoom,
      maxZoom: 22,
      crossOrigin: true,
    }).addTo(activeMap)
    offlineBaseLayerRef.current.bringToBack()
    activeMap.fitBounds(
      [[area.bounds.south, area.bounds.west], [area.bounds.north, area.bounds.east]],
      { padding: [24, 24], maxZoom: Math.min(area.maxZoom, 16) }
    )
  }

  useEffect(() => {
    if (online || areas.length === 0) return
    const active = areas.find(area => area.id === activeAreaId)
    if (active) void activateArea(active)
    // Kun ved offline-skift/map-ready; activateArea ændrer selv activeAreaId.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [online, mapVersion, areas.length])

  function beginSelection() {
    if (!online) {
      setError('Du skal være online for at hente et nyt offlineområde.')
      return
    }
    if (!geodanmarkAvailable) {
      setError('GeoDanmark er ikke tilgængeligt. Dataforsyningen-token mangler.')
      return
    }
    setShowList(false)
    setShowConfigure(false)
    setSelectedBounds(null)
    setSelectionStep(0)
    setError(null)
    setSelecting(true)
  }

  function cancelSelection() {
    setSelecting(false)
    setSelectionStep(0)
    firstCornerRef.current = null
    selectionLayerRef.current?.remove()
    selectionLayerRef.current = null
  }

  function closeConfigure() {
    if (downloading) return
    setShowConfigure(false)
    setSelectedBounds(null)
    setError(null)
    selectionLayerRef.current?.remove()
    selectionLayerRef.current = null
  }

  async function removeArea(area: OfflineMapArea) {
    if (!window.confirm(`Slet offlineområdet “${area.name}”?`)) return
    try {
      await deleteOfflineArea(area.id)
      await refreshAreas()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Offlineområdet kunne ikke slettes')
    }
  }

  async function downloadArea() {
    if (!selectedBounds || !downloadBounds || downloading || tooManyTiles) return
    const name = areaName.trim()
    if (!name) {
      setError('Giv offlineområdet et navn.')
      return
    }
    if (!online) {
      setError('Forbindelsen er væk. Gå online igen for at starte download.')
      return
    }

    const id = crypto.randomUUID()
    const cacheName = areaCacheName(id)
    setDownloading(true)
    setError(null)
    setDownloadProgress({ done: 0, total: tiles.length, bytes: 0 })

    try {
      if ('storage' in navigator && 'persist' in navigator.storage) {
        try { await navigator.storage.persist() } catch { /* ikke kritisk */ }
      }

      const cache = await caches.open(cacheName)
      let cursor = 0
      let done = 0
      let bytes = 0

      const worker = async () => {
        while (cursor < tiles.length) {
          const tile = tiles[cursor++]
          const request = new Request(tileUrl(tile.z, tile.x, tile.y), { credentials: 'include' })
          const response = await fetch(request)
          if (!response.ok) throw new Error(`Kortfelt ${tile.z}/${tile.x}/${tile.y} kunne ikke hentes`)
          const size = (await response.clone().blob()).size
          await cache.put(request, response)
          bytes += size
          done += 1
          if (done % 5 === 0 || done === tiles.length) {
            setDownloadProgress({ done, total: tiles.length, bytes })
          }
        }
      }

      await Promise.all(Array.from({ length: Math.min(DOWNLOAD_CONCURRENCY, tiles.length) }, () => worker()))

      let pinAssetBytes = 0
      const localAssetUrls = new Set<string>()
      for (const pin of pinsInArea) {
        if (pin.icon.startsWith('/')) localAssetUrls.add(pin.icon)
        for (const image of pin.images) {
          try {
            const url = new URL(image.url, window.location.origin)
            if (url.origin === window.location.origin) localAssetUrls.add(`${url.pathname}${url.search}`)
          } catch { /* ignorer ugyldig billed-URL */ }
        }
      }
      for (const url of localAssetUrls) {
        try {
          const request = new Request(url, { credentials: 'include' })
          const response = await fetch(request)
          if (response.ok) {
            pinAssetBytes += (await response.clone().blob()).size
            await cache.put(request, response)
          }
        } catch {
          // Et manglende pin-billede må ikke ødelægge hele kortpakken.
        }
      }

      const finalPinBytes = pinBytes + pinAssetBytes
      const now = new Date().toISOString()
      const area: OfflineMapArea = {
        id,
        name,
        bounds: selectedBounds,
        downloadBounds,
        quality,
        minZoom: OFFLINE_MIN_ZOOM,
        maxZoom,
        tileCount: tiles.length,
        mapBytes: bytes,
        pinBytes: finalPinBytes,
        routeBytes,
        totalBytes: bytes + finalPinBytes + routeBytes,
        pins: pinsInArea,
        categories,
        routes: routesInArea,
        createdAt: now,
        updatedAt: now,
      }
      await saveOfflineArea(area)
      await askServiceWorkerToCacheShell()
      setActiveOfflineAreaId(id)
      setActiveAreaIdState(id)
      await refreshAreas()
      setShowConfigure(false)
      selectionLayerRef.current?.remove()
      selectionLayerRef.current = null
      setSelectedBounds(null)
      await activateArea(area)
    } catch (cause) {
      await caches.delete(cacheName)
      setError(cause instanceof Error ? cause.message : 'Offlineområdet kunne ikke downloades')
    } finally {
      setDownloading(false)
      setDownloadProgress(null)
    }
  }

  const progressPercent = downloadProgress && downloadProgress.total > 0
    ? Math.round((downloadProgress.done / downloadProgress.total) * 100)
    : 0

  return (
    <>
      <button
        type="button"
        onClick={() => { setError(null); void refreshAreas(); setShowList(true) }}
        className="absolute right-2 top-24 z-[1200] rounded-xl border border-void-600 bg-void-900/95 px-3 py-2 text-xs font-semibold text-gray-100 shadow-xl backdrop-blur-sm hover:bg-void-800 md:bottom-4 md:right-4 md:top-auto"
      >
        ⬇ Offlinekort{!online ? ' · OFFLINE' : ''}
      </button>

      {selecting && (
        <div className="absolute left-1/2 top-3 z-[1600] w-[min(92vw,460px)] -translate-x-1/2 rounded-xl border border-rust-700/70 bg-void-900/95 px-4 py-3 text-center shadow-2xl backdrop-blur-sm">
          <p className="text-sm font-semibold text-gray-100">
            {selectionStep === 1 ? 'Tryk på modsatte hjørne' : 'Vælg første hjørne af offlineområdet'}
          </p>
          <p className="mt-1 text-xs text-gray-400">Området får automatisk {OFFLINE_BUFFER_KM} km sikkerhedsbuffer.</p>
          <button type="button" onClick={cancelSelection} className="btn-secondary mt-3 px-3 py-2 text-xs">
            Annuller
          </button>
        </div>
      )}

      {showList && (
        <div className="fixed inset-0 z-[3000] flex items-center justify-center bg-black/70 px-4" onClick={() => setShowList(false)}>
          <div className="flex max-h-[82dvh] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-void-700 bg-void-900 shadow-2xl" onClick={event => event.stopPropagation()}>
            <div className="flex items-start justify-between gap-4 border-b border-void-700 px-5 py-4">
              <div>
                <h2 className="text-lg font-semibold text-gray-100">Offlinekort</h2>
                <p className="mt-1 text-sm text-gray-400">
                  {online ? 'Vælg et gemt område eller download et nyt.' : 'Du er offline. Vælg et område der allerede er gemt.'}
                </p>
              </div>
              <button type="button" onClick={() => setShowList(false)} className="text-2xl leading-none text-gray-500 hover:text-gray-200" aria-label="Luk offlinekort">×</button>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto p-4">
              {error && <div className="mb-3 rounded-xl border border-red-900/60 bg-red-950/70 px-3 py-2 text-sm text-red-200">{error}</div>}

              {areas.length === 0 ? (
                <div className="py-8 text-center text-sm text-gray-500">Der er ingen offlineområder på denne enhed endnu.</div>
              ) : (
                <div className="space-y-2.5">
                  {areas.map(area => (
                    <div key={area.id} className="rounded-xl border border-void-700 bg-void-800/70 p-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="truncate font-semibold text-gray-100">{area.name}</p>
                            {activeAreaId === area.id && <span className="rounded-full bg-green-900/60 px-2 py-0.5 text-[10px] font-bold text-green-300">AKTIV</span>}
                          </div>
                          <p className="mt-1 text-xs text-gray-400">{OFFLINE_QUALITY[area.quality]?.label ?? area.quality} · {formatOfflineBytes(area.totalBytes)} · {area.pins.length} pins · {area.routes.length} ruter</p>
                          <p className="mt-1 text-[11px] text-gray-600">Gemt {new Date(area.updatedAt).toLocaleDateString('da-DK')} · zoom {area.minZoom}–{area.maxZoom}</p>
                        </div>
                      </div>
                      <div className="mt-3 flex gap-2">
                        <button type="button" onClick={() => void activateArea(area)} className="btn-primary flex-1 px-3 py-2 text-xs">
                          {activeAreaId === area.id ? 'Åbn igen' : 'Åbn'}
                        </button>
                        <button type="button" onClick={() => void removeArea(area)} className="btn-danger px-3 py-2 text-xs">Slet</button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="border-t border-void-700 p-4">
              <button
                type="button"
                disabled={!online || !geodanmarkAvailable}
                onClick={beginSelection}
                className="btn-primary w-full disabled:cursor-not-allowed disabled:opacity-40"
              >
                + Nyt offlineområde
              </button>
              {!online && <p className="mt-2 text-center text-xs text-gray-500">Nye områder kan kun downloades, når du er online.</p>}
              {online && !geodanmarkAvailable && <p className="mt-2 text-center text-xs text-red-400">GeoDanmark kræver et Dataforsyningen-token.</p>}
            </div>
          </div>
        </div>
      )}

      {showConfigure && selectedBounds && downloadBounds && (
        <div className="fixed inset-0 z-[3100] flex items-center justify-center bg-black/70 px-4" onClick={closeConfigure}>
          <div className="max-h-[88dvh] w-full max-w-lg overflow-y-auto rounded-2xl border border-void-700 bg-void-900 p-5 shadow-2xl" onClick={event => event.stopPropagation()}>
            <div className="mb-5 flex items-start justify-between gap-4">
              <div>
                <h2 className="text-lg font-semibold text-gray-100">Gem område offline</h2>
                <p className="mt-1 text-sm text-gray-400">GeoDanmark luftfoto + dine Urban Explorer-data.</p>
              </div>
              <button type="button" disabled={downloading} onClick={closeConfigure} className="text-2xl leading-none text-gray-500 hover:text-gray-200 disabled:opacity-40">×</button>
            </div>

            <label className="block">
              <span className="mb-1.5 block text-sm font-medium text-gray-300">Navn</span>
              <input className="input" value={areaName} disabled={downloading} maxLength={80} onChange={event => setAreaName(event.target.value)} />
            </label>

            <label className="mt-4 block">
              <span className="mb-1.5 block text-sm font-medium text-gray-300">Zoom / kvalitet</span>
              <select className="input" value={quality} disabled={downloading} onChange={event => setQuality(event.target.value as OfflineMapQuality)}>
                {(Object.keys(OFFLINE_QUALITY) as OfflineMapQuality[]).map(key => (
                  <option key={key} value={key}>{OFFLINE_QUALITY[key].label} · zoom {OFFLINE_MIN_ZOOM}–{OFFLINE_QUALITY[key].maxZoom}</option>
                ))}
              </select>
              <p className="mt-1.5 text-xs text-gray-500">{OFFLINE_QUALITY[quality].description} · {OFFLINE_BUFFER_KM} km buffer uden om dit valgte område.</p>
            </label>

            <div className="mt-5 rounded-xl border border-void-700 bg-void-800/70 p-4">
              <div className="space-y-2.5 text-sm">
                <div className="flex items-center justify-between gap-4"><span className="text-gray-300">Luftfoto Danmark</span><span className="font-medium text-gray-100">{estimating ? 'Beregner…' : `ca. ${formatOfflineBytes(estimatedMapBytes)}`}</span></div>
                <div className="flex items-center justify-between gap-4"><span className="text-gray-300">Pins ({pinsInArea.length})</span><span className="font-medium text-gray-100">{formatOfflineBytes(pinBytes)}</span></div>
                <div className="flex items-center justify-between gap-4"><span className="text-gray-300">Gemte ruter ({routesLoading ? '…' : routesInArea.length})</span><span className="font-medium text-gray-100">{routesLoading ? 'Henter…' : formatOfflineBytes(routeBytes)}</span></div>
                <div className="border-t border-void-600 pt-2.5 flex items-center justify-between gap-4"><span className="font-semibold text-gray-200">I alt</span><span className="text-base font-bold text-rust-400">ca. {formatOfflineBytes(estimatedTotalBytes)}</span></div>
              </div>
              <p className="mt-3 text-[11px] leading-4 text-gray-500">{selectionAreaKm2.toLocaleString('da-DK', { maximumFractionDigits: 1 })} km² valgt · {tiles.length.toLocaleString('da-DK')} kortfelter. Pin-billeder lægges også i pakken; den endelige størrelse kan derfor være lidt større.</p>
            </div>

            <div className="mt-4 rounded-xl border border-void-700 bg-void-800/50 p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h3 className="text-sm font-semibold text-gray-100">Ruter der kommer med</h3>
                  <p className="mt-1 text-xs text-gray-500">Ruter der berører området eller sikkerhedsbufferen gemmes i offlineområdet.</p>
                </div>
                {!routesLoading && (
                  <span className="rounded-full border border-void-600 bg-void-900 px-2.5 py-1 text-xs font-semibold text-gray-300">
                    {routesInArea.length}
                  </span>
                )}
              </div>

              {routesLoading ? (
                <div className="mt-4 flex items-center gap-2 text-xs text-gray-400">
                  <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-gray-500/40 border-t-gray-200" aria-hidden="true" />
                  <span>Kontrollerer gemte ruter…</span>
                </div>
              ) : routeChecks.length === 0 ? (
                <p className="mt-4 text-xs text-gray-500">Ingen gemte ruter berører det valgte område.</p>
              ) : (
                <div className="mt-4 space-y-2.5">
                  {routeChecks.map(check => {
                    const hasOutsideStops = check.outsideStops.length > 0
                    return (
                      <div
                        key={check.route.id}
                        className={`rounded-lg border p-3 ${hasOutsideStops ? 'border-amber-800/70 bg-amber-950/35' : 'border-void-600 bg-void-900/60'}`}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <p className="min-w-0 flex-1 truncate text-sm font-semibold text-gray-100">{check.route.name}</p>
                          <span className="shrink-0 text-[11px] text-gray-500">{check.stopCount} stop</span>
                        </div>

                        {hasOutsideStops ? (
                          <>
                            <p className="mt-2 text-xs font-semibold text-amber-300">
                              ⚠ {check.outsideStops.length} {check.outsideStops.length === 1 ? 'stop ligger' : 'stop ligger'} uden for dit markerede område
                            </p>
                            <div className="mt-2 flex flex-wrap gap-1.5">
                              {check.outsideStops.map(stop => (
                                <span key={stop} className="rounded-md border border-amber-800/60 bg-amber-950/60 px-2 py-1 text-[11px] text-amber-100">
                                  {stop}
                                </span>
                              ))}
                            </div>
                            <p className="mt-2 text-[11px] leading-4 text-amber-200/70">
                              Ruten gemmes stadig, men stop uden for området kan mangle luftfoto eller pin-data. Udvid området før download, hvis de skal dækkes med.
                            </p>
                          </>
                        ) : (
                          <p className="mt-2 text-xs text-green-300">✓ Alle rutens stop ligger i det markerede område.</p>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}

              {!routesLoading && routesWithOutsideStops.length > 0 && (
                <div className="mt-3 rounded-lg border border-amber-800/50 bg-amber-950/30 px-3 py-2 text-xs leading-5 text-amber-200">
                  {routesWithOutsideStops.length} {routesWithOutsideStops.length === 1 ? 'rute har' : 'ruter har'} stop uden for dit markerede område. Du kan annullere og markere et større område, før du downloader.
                </div>
              )}
            </div>

            {tooManyTiles && (
              <div className="mt-4 rounded-xl border border-amber-800/70 bg-amber-950/50 px-3 py-2 text-sm text-amber-200">
                Området er for stort ved denne kvalitet ({tiles.length.toLocaleString('da-DK')} kortfelter). Vælg lavere kvalitet eller et mindre område. Maksimum er {OFFLINE_MAX_TILES.toLocaleString('da-DK')} felter pr. pakke.
              </div>
            )}
            {error && <div className="mt-4 rounded-xl border border-red-900/60 bg-red-950/70 px-3 py-2 text-sm text-red-200">{error}</div>}

            {downloading && downloadProgress && (
              <div className="mt-5">
                <div className="mb-2 flex items-center justify-between text-xs text-gray-400"><span>Downloader luftfoto…</span><span>{progressPercent}%</span></div>
                <div className="h-2 overflow-hidden rounded-full bg-void-700"><div className="h-full bg-rust-600 transition-[width]" style={{ width: `${progressPercent}%` }} /></div>
                <p className="mt-2 text-center text-xs text-gray-500">{downloadProgress.done.toLocaleString('da-DK')} / {downloadProgress.total.toLocaleString('da-DK')} felter · {formatOfflineBytes(downloadProgress.bytes)}</p>
              </div>
            )}

            <div className="mt-6 flex justify-end gap-2">
              <button type="button" disabled={downloading} onClick={closeConfigure} className="btn-secondary px-4 py-2.5 disabled:opacity-40">Annuller</button>
              <button
                type="button"
                disabled={downloading || tooManyTiles || estimating || routesLoading || tiles.length === 0}
                onClick={() => void downloadArea()}
                className="btn-primary min-w-[170px] px-5 py-2.5 disabled:cursor-wait disabled:opacity-50"
              >
                {downloading ? `Downloader ${progressPercent}%` : 'Download offline'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
