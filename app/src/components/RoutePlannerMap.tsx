'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import type * as Leaflet from 'leaflet'
import 'leaflet/dist/leaflet.css'
import type { Category, Pin, PinStatus } from '@/types/pin'
import { PIN_STATUSES, PIN_STATUS_COLORS, PIN_STATUS_LABELS } from '@/types/pin'

type MapProvider = 'maptiler' | 'esri'
type EndpointChoice = 'current' | string

interface Props {
  maptilerKey: string
  mapProvider: MapProvider
  geodanmarkAvailable: boolean
  initialPins: Pin[]
  categories: Category[]
}

interface RouteLeg {
  fromId: string | null
  toId: string | null
  distanceKm: number | null
  durationSeconds: number | null
}

interface RouteResult {
  optimized: boolean
  orderedStopIds: string[]
  shapes: string[]
  legs: RouteLeg[]
  distanceKm: number | null
  durationSeconds: number | null
}

interface RouteApiResult extends RouteResult {
  error?: string
  failedStopId?: string
}

interface RouteStop {
  id: string
  lat: number
  lng: number
}

type UrbanExplorerWindow = Window & {
  __urbanExplorerMapZoom?: number
  __urbanExplorerMapCenter?: [number, number]
}

const DEFAULT_CENTER: [number, number] = [55.5, 10.4]
const DEFAULT_ZOOM = 7
const NO_CATEGORY = '__none__'
const CURRENT_START_ID = '__current_start__'
const CURRENT_END_ID = '__current_end__'

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;')
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

function formatDuration(seconds: number | null): string | null {
  if (seconds === null || !Number.isFinite(seconds)) return null
  const minutes = Math.max(1, Math.round(seconds / 60))
  if (minutes < 60) return `${minutes} min.`
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return rest ? `${hours} t. ${rest} min.` : `${hours} t.`
}

function formatDistance(km: number | null): string | null {
  if (km === null || !Number.isFinite(km)) return null
  return `${km.toLocaleString('da-DK', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} km`
}

function baseTileConfig(mapProvider: MapProvider, maptilerKey: string, geodanmarkAvailable: boolean) {
  if (geodanmarkAvailable) {
    return {
      url: '/api/map-tiles/geodanmark/{z}/{x}/{y}',
      attribution: '&copy; Klimadatastyrelsen / GeoDanmark',
      maxNativeZoom: 20,
    }
  }

  if (mapProvider === 'esri') {
    return {
      url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
      attribution: 'Tiles &copy; Esri',
      maxNativeZoom: 19,
    }
  }

  return {
    url: `https://api.maptiler.com/maps/satellite-v4/256/{z}/{x}/{y}.jpg?key=${maptilerKey}`,
    attribution: '&copy; MapTiler &copy; OpenStreetMap contributors',
    maxNativeZoom: 20,
  }
}

function getCurrentPosition(): Promise<{ lat: number; lng: number }> {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error('Din browser understøtter ikke aktuel placering.'))
      return
    }

    navigator.geolocation.getCurrentPosition(
      position => resolve({ lat: position.coords.latitude, lng: position.coords.longitude }),
      error => {
        if (error.code === error.PERMISSION_DENIED) {
          reject(new Error('Tillad adgang til din placering for at bruge “Aktuel placering”.'))
        } else if (error.code === error.TIMEOUT) {
          reject(new Error('Din aktuelle placering kunne ikke findes hurtigt nok. Prøv igen.'))
        } else {
          reject(new Error('Din aktuelle placering kunne ikke findes.'))
        }
      },
      { enableHighAccuracy: true, timeout: 12_000, maximumAge: 15_000 }
    )
  })
}

export default function RoutePlannerMap({ maptilerKey, mapProvider, geodanmarkAvailable, initialPins, categories }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<Leaflet.Map | null>(null)
  const leafletRef = useRef<typeof Leaflet | null>(null)
  const markerLayerRef = useRef<Leaflet.LayerGroup | null>(null)
  const routeLayerRef = useRef<Leaflet.LayerGroup | null>(null)

  const [mapReady, setMapReady] = useState(false)
  const [selecting, setSelecting] = useState(false)
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [routing, setRouting] = useState(false)
  const [routeError, setRouteError] = useState<string | null>(null)
  const [routeResult, setRouteResult] = useState<RouteResult | null>(null)
  const [showRouteSetup, setShowRouteSetup] = useState(false)
  const [startChoice, setStartChoice] = useState<EndpointChoice>('current')
  const [endChoice, setEndChoice] = useState<EndpointChoice>('current')
  const [activeCategoryIds, setActiveCategoryIds] = useState<Set<string>>(
    () => new Set([...categories.map(category => category.id), NO_CATEGORY])
  )
  const [activeStatuses, setActiveStatuses] = useState<Set<PinStatus>>(() => new Set(PIN_STATUSES))
  const [activeRatings, setActiveRatings] = useState<Set<number>>(() => new Set([0, 1, 2, 3]))

  const visiblePins = useMemo(() => initialPins.filter(pin => {
    const categoryMatch = pin.categories.length > 0
      ? pin.categories.some(category => activeCategoryIds.has(category.id))
      : activeCategoryIds.has(NO_CATEGORY)
    return categoryMatch && activeStatuses.has(pin.status) && activeRatings.has(pin.rating)
  }), [initialPins, activeCategoryIds, activeStatuses, activeRatings])

  const selectedPins = useMemo(() => selectedIds
    .map(id => initialPins.find(pin => pin.id === id))
    .filter((pin): pin is Pin => Boolean(pin)), [selectedIds, initialPins])

  function stopLabel(id: string | null): string {
    if (!id) return 'Ukendt stop'
    if (id === CURRENT_START_ID || id === CURRENT_END_ID) return 'Aktuel placering'
    return initialPins.find(pin => pin.id === id)?.name || 'Ukendt pin'
  }

  useEffect(() => {
    let cancelled = false

    const init = async () => {
      const leafletModule = await import('leaflet')
      const L = (leafletModule as unknown as { default?: typeof Leaflet }).default
        ?? (leafletModule as unknown as typeof Leaflet)
      if (cancelled || !containerRef.current) return

      leafletRef.current = L
      const browserWindow = window as UrbanExplorerWindow
      const inheritedCenter = browserWindow.__urbanExplorerMapCenter ?? DEFAULT_CENTER
      const inheritedZoom = browserWindow.__urbanExplorerMapZoom ?? DEFAULT_ZOOM

      const map = L.map(containerRef.current, {
        center: inheritedCenter,
        zoom: inheritedZoom,
        zoomControl: true,
        maxZoom: 22,
        doubleClickZoom: true,
      })

      const tiles = baseTileConfig(mapProvider, maptilerKey, geodanmarkAvailable)
      L.tileLayer(tiles.url, {
        attribution: tiles.attribution,
        maxNativeZoom: tiles.maxNativeZoom,
        maxZoom: 22,
      }).addTo(map)

      markerLayerRef.current = L.layerGroup().addTo(map)
      routeLayerRef.current = L.layerGroup().addTo(map)

      const syncView = () => {
        const center = map.getCenter()
        browserWindow.__urbanExplorerMapCenter = [center.lat, center.lng]
        browserWindow.__urbanExplorerMapZoom = map.getZoom()
      }
      map.on('moveend zoomend', syncView)
      syncView()

      mapRef.current = map
      setMapReady(true)
      requestAnimationFrame(() => map.invalidateSize())
    }

    void init()

    return () => {
      cancelled = true
      mapRef.current?.remove()
      mapRef.current = null
      markerLayerRef.current = null
      routeLayerRef.current = null
      leafletRef.current = null
    }
  }, [mapProvider, maptilerKey, geodanmarkAvailable])

  useEffect(() => {
    const L = leafletRef.current
    const layer = markerLayerRef.current
    if (!L || !layer || !mapReady) return

    layer.clearLayers()

    for (const pin of visiblePins) {
      const selectedIndex = selectedIds.indexOf(pin.id)
      const selected = selectedIndex >= 0
      const statusColor = PIN_STATUS_COLORS[pin.status]
      const iconContent = pin.icon.startsWith('/')
        ? `<img src="${escapeHtml(pin.icon)}" alt="" style="width:28px;height:28px;display:block;" />`
        : `<span style="font-size:24px;line-height:28px;">${escapeHtml(pin.icon)}</span>`
      const badge = selected
        ? `<span style="position:absolute;right:-8px;top:-8px;width:22px;height:22px;border-radius:999px;background:#d97706;color:white;font-size:11px;font-weight:800;display:flex;align-items:center;justify-content:center;border:2px solid #111827;">${selectedIndex + 1}</span>`
        : ''

      const icon = L.divIcon({
        className: '',
        html: `<div style="position:relative;width:38px;height:38px;border-radius:999px;background:#111827;border:${selected ? '3px solid #f59e0b' : `2px solid ${statusColor}`};display:flex;align-items:center;justify-content:center;box-shadow:0 2px 8px rgba(0,0,0,.55);">${iconContent}${badge}</div>`,
        iconSize: [38, 38],
        iconAnchor: [19, 19],
      })

      const marker = L.marker([pin.latitude, pin.longitude], {
        icon,
        interactive: selecting,
        keyboard: selecting,
        riseOnHover: true,
      })

      if (selecting) {
        marker.on('click', () => {
          setRouteResult(null)
          setRouteError(null)
          setSelectedIds(previous => {
            const existing = previous.indexOf(pin.id)
            return existing >= 0 ? previous.filter(id => id !== pin.id) : [...previous, pin.id]
          })
        })
      }

      marker.addTo(layer)
    }
  }, [mapReady, visiblePins, selecting, selectedIds])

  useEffect(() => {
    const L = leafletRef.current
    const map = mapRef.current
    const layer = routeLayerRef.current
    if (!L || !map || !layer) return

    layer.clearLayers()
    if (!routeResult) return

    const allPoints: [number, number][] = []
    for (const shape of routeResult.shapes) {
      const points = decodePolyline6(shape)
      if (points.length < 2) continue
      allPoints.push(...points)
      L.polyline(points, {
        color: '#f59e0b',
        weight: 6,
        opacity: 0.9,
        lineJoin: 'round',
        lineCap: 'round',
      }).addTo(layer)
    }

    if (allPoints.length > 1) {
      map.fitBounds(L.latLngBounds(allPoints), { padding: [50, 50], maxZoom: 16 })
    }
  }, [routeResult])

  function toggleCategory(id: string) {
    setActiveCategoryIds(previous => {
      const next = new Set(previous)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  function toggleStatus(status: PinStatus) {
    setActiveStatuses(previous => {
      const next = new Set(previous)
      if (next.has(status)) next.delete(status); else next.add(status)
      return next
    })
  }

  function toggleRating(rating: number) {
    setActiveRatings(previous => {
      const next = new Set(previous)
      if (next.has(rating)) next.delete(rating); else next.add(rating)
      return next
    })
  }

  function startSelecting() {
    setSelectedIds([])
    setRouteResult(null)
    setRouteError(null)
    setShowRouteSetup(false)
    setSelecting(true)
  }

  function cancelSelecting() {
    setSelecting(false)
    setSelectedIds([])
    setRouteResult(null)
    setRouteError(null)
    setShowRouteSetup(false)
  }

  function openRouteSetup() {
    if (selectedIds.length < 2) return
    setRouteError(null)
    setStartChoice('current')
    setEndChoice('current')
    setShowRouteSetup(true)
  }

  function pinToStop(pin: Pin): RouteStop {
    return { id: pin.id, lat: pin.latitude, lng: pin.longitude }
  }

  function friendlyRouteError(data: RouteApiResult): string {
    if (!data.failedStopId) return data.error || 'Køreruten kunne ikke beregnes'
    if (data.failedStopId === CURRENT_START_ID || data.failedStopId === CURRENT_END_ID) {
      return 'Din aktuelle placering kunne ikke forbindes til en kørbar vej inden for 5 km.'
    }
    const pin = initialPins.find(item => item.id === data.failedStopId)
    return pin
      ? `“${pin.name}” kunne ikke forbindes til en kørbar vej inden for 5 km.`
      : data.error || 'Et valgt pin kunne ikke forbindes til en kørbar vej.'
  }

  async function createOptimizedRoute() {
    if (selectedIds.length < 2 || routing) return

    if (startChoice !== 'current' && endChoice !== 'current' && startChoice === endChoice) {
      setRouteError('Start og slut kan ikke være det samme valgte pin.')
      return
    }

    const startPin = startChoice === 'current' ? null : selectedPins.find(pin => pin.id === startChoice) ?? null
    const endPin = endChoice === 'current' ? null : selectedPins.find(pin => pin.id === endChoice) ?? null

    if (startChoice !== 'current' && !startPin) {
      setRouteError('Det valgte startpunkt findes ikke længere blandt de valgte pins.')
      return
    }
    if (endChoice !== 'current' && !endPin) {
      setRouteError('Det valgte slutpunkt findes ikke længere blandt de valgte pins.')
      return
    }

    setRouting(true)
    setRouteError(null)

    try {
      const needsCurrentPosition = startChoice === 'current' || endChoice === 'current'
      const currentPosition = needsCurrentPosition ? await getCurrentPosition() : null

      const startStop: RouteStop = startChoice === 'current'
        ? { id: CURRENT_START_ID, lat: currentPosition!.lat, lng: currentPosition!.lng }
        : pinToStop(startPin!)
      const endStop: RouteStop = endChoice === 'current'
        ? { id: CURRENT_END_ID, lat: currentPosition!.lat, lng: currentPosition!.lng }
        : pinToStop(endPin!)

      const middleStops = selectedPins
        .filter(pin => pin.id !== startChoice && pin.id !== endChoice)
        .map(pinToStop)
      const stops = [startStop, ...middleStops, endStop]

      const response = await fetch('/api/route-planner/optimized', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stops }),
      })

      const text = await response.text()
      let data: RouteApiResult
      try {
        data = JSON.parse(text) as RouteApiResult
      } catch {
        throw new Error(response.ok
          ? 'Rute-serveren gav et ugyldigt svar'
          : `Rute-serveren svarede med HTTP ${response.status}. Prøv igen om lidt.`)
      }

      if (!response.ok) throw new Error(friendlyRouteError(data))

      setRouteResult(data)
      const selectedIdSet = new Set(selectedIds)
      const optimizedPins = data.orderedStopIds.filter(id => selectedIdSet.has(id))
      if (optimizedPins.length === selectedIds.length) setSelectedIds(optimizedPins)
      setSelecting(false)
      setShowRouteSetup(false)
    } catch (error) {
      setRouteError(error instanceof Error ? error.message : 'Køreruten kunne ikke beregnes')
    } finally {
      setRouting(false)
    }
  }

  const duration = formatDuration(routeResult?.durationSeconds ?? null)
  const distanceLabel = formatDistance(routeResult?.distanceKm ?? null)

  return (
    <div className="relative w-full h-[calc(100dvh-4rem)] min-h-[520px] overflow-hidden bg-void-950">
      <div ref={containerRef} className="absolute inset-0" />

      <aside className="absolute left-2 top-2 z-[500] w-28 md:w-32 rounded-xl border border-void-700 bg-void-900/90 p-2 shadow-xl backdrop-blur-sm">
        <p className="mb-1 text-[10px] text-gray-500">Kategorier</p>
        <div className="flex flex-wrap gap-1">
          {categories.filter(category => !category.ownerId).map(category => (
            <button
              key={category.id}
              type="button"
              onClick={() => toggleCategory(category.id)}
              className={`rounded-full px-2 py-1 text-[10px] font-semibold text-white transition-opacity ${activeCategoryIds.has(category.id) ? 'opacity-100' : 'opacity-35'}`}
              style={{ backgroundColor: category.color }}
            >
              {category.name}
            </button>
          ))}
          <button
            type="button"
            onClick={() => toggleCategory(NO_CATEGORY)}
            className={`rounded-full bg-gray-700 px-2 py-1 text-[10px] font-semibold text-white ${activeCategoryIds.has(NO_CATEGORY) ? 'opacity-100' : 'opacity-35'}`}
          >
            Ingen kategori
          </button>
        </div>

        <p className="mb-1 mt-3 text-[10px] text-gray-500">Mærke</p>
        <div className="flex flex-wrap gap-1">
          {PIN_STATUSES.map(status => (
            <button
              key={status}
              type="button"
              onClick={() => toggleStatus(status)}
              className={`rounded-full px-2 py-1 text-[10px] font-semibold text-white ${activeStatuses.has(status) ? 'opacity-100' : 'opacity-35'}`}
              style={{ backgroundColor: PIN_STATUS_COLORS[status] }}
            >
              {PIN_STATUS_LABELS[status]}
            </button>
          ))}
        </div>

        <p className="mb-1 mt-3 text-[10px] text-gray-500">Rating</p>
        <div className="flex flex-wrap gap-1">
          {[0, 1, 2, 3].map(rating => (
            <button
              key={rating}
              type="button"
              onClick={() => toggleRating(rating)}
              className={`rounded-full px-2 py-1 text-[10px] font-semibold ${rating === 0 ? 'bg-gray-700 text-white' : 'bg-rust-600 text-white'} ${activeRatings.has(rating) ? 'opacity-100' : 'opacity-35'}`}
            >
              {rating === 0 ? 'Ingen' : '★'.repeat(rating)}
            </button>
          ))}
        </div>
      </aside>

      {selecting && !showRouteSetup && (
        <div className="absolute left-1/2 top-3 z-[600] -translate-x-1/2 rounded-xl border border-void-700 bg-void-900/95 px-4 py-2 text-center shadow-xl backdrop-blur-sm">
          <p className="text-sm font-semibold text-gray-100">Vælg pins på kortet</p>
          <p className="mt-0.5 text-[11px] text-gray-400">{selectedIds.length} valgt</p>
        </div>
      )}

      {routeResult && (
        <>
          <div className="absolute left-1/2 top-3 z-[600] -translate-x-1/2 rounded-xl border border-void-700 bg-void-900/95 px-4 py-2 text-center shadow-xl backdrop-blur-sm">
            <p className="text-sm font-semibold text-gray-100">Optimeret kørerute</p>
            <p className="mt-0.5 text-[11px] text-gray-400">
              {selectedIds.length} valgte pins
              {distanceLabel ? ` · ${distanceLabel}` : ''}
              {duration ? ` · ${duration}` : ''}
            </p>
          </div>

          {routeResult.legs.length > 0 && (
            <aside className="absolute bottom-4 left-2 z-[650] w-[min(340px,calc(100vw-1rem))] max-h-[55vh] overflow-y-auto rounded-xl border border-void-700 bg-void-900/95 shadow-xl backdrop-blur-sm">
              <div className="sticky top-0 border-b border-void-700 bg-void-900/95 px-3 py-2.5">
                <p className="text-sm font-semibold text-gray-100">Rute</p>
                <p className="text-[11px] text-gray-500">{routeResult.legs.length} etaper</p>
              </div>
              <div className="divide-y divide-void-700/70">
                {routeResult.legs.map((leg, index) => {
                  const legDuration = formatDuration(leg.durationSeconds)
                  const legDistance = formatDistance(leg.distanceKm)
                  return (
                    <div key={`${leg.fromId}-${leg.toId}-${index}`} className="flex gap-3 px-3 py-3">
                      <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-rust-600 text-[11px] font-bold text-white">
                        {index + 1}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-[12px] font-medium leading-4 text-gray-200">
                          <span className="break-words">{stopLabel(leg.fromId)}</span>
                          <span className="mx-1.5 text-rust-400">→</span>
                          <span className="break-words">{stopLabel(leg.toId)}</span>
                        </p>
                        <p className="mt-1 text-[11px] text-gray-400">
                          {legDistance ?? 'Ukendt afstand'}
                          {legDuration ? ` · ${legDuration}` : ''}
                        </p>
                      </div>
                    </div>
                  )
                })}
              </div>
            </aside>
          )}
        </>
      )}

      {routeError && !showRouteSetup && (
        <div className="absolute bottom-24 left-1/2 z-[700] w-[min(90vw,520px)] -translate-x-1/2 rounded-xl border border-red-900/60 bg-red-950/90 px-4 py-3 text-center text-sm text-red-200 shadow-xl">
          {routeError}
        </div>
      )}

      <div className="absolute bottom-5 left-1/2 z-[700] flex -translate-x-1/2 items-center gap-2">
        {!selecting && !routeResult && (
          <button type="button" onClick={startSelecting} className="btn-primary whitespace-nowrap px-5 py-3 shadow-xl">
            Vælg pins
          </button>
        )}

        {selecting && !showRouteSetup && (
          <>
            <button type="button" onClick={cancelSelecting} className="btn-secondary whitespace-nowrap px-4 py-3 shadow-xl">
              Annuller
            </button>
            <button
              type="button"
              onClick={openRouteSetup}
              disabled={selectedIds.length < 2}
              className="btn-primary whitespace-nowrap px-5 py-3 shadow-xl disabled:cursor-not-allowed disabled:opacity-40"
            >
              Lav en optimeret kørerute
            </button>
          </>
        )}

        {routeResult && (
          <button type="button" onClick={startSelecting} className="btn-primary whitespace-nowrap px-5 py-3 shadow-xl">
            Vælg pins igen
          </button>
        )}
      </div>

      {showRouteSetup && (
        <div
          className="fixed inset-0 z-[2000] flex items-center justify-center bg-black/65 px-4"
          onClick={() => { if (!routing) setShowRouteSetup(false) }}
        >
          <div
            className="w-full max-w-md rounded-2xl border border-void-700 bg-void-900 p-5 shadow-2xl"
            onClick={event => event.stopPropagation()}
          >
            <div className="mb-5 flex items-start justify-between gap-4">
              <div>
                <h2 className="text-lg font-semibold text-gray-100">Vælg start og slut</h2>
                <p className="mt-1 text-sm text-gray-400">De øvrige valgte pins bliver optimeret som mellemstop.</p>
              </div>
              <button
                type="button"
                disabled={routing}
                onClick={() => setShowRouteSetup(false)}
                className="text-2xl leading-none text-gray-500 hover:text-gray-200 disabled:opacity-40"
              >
                ×
              </button>
            </div>

            <div className="space-y-4">
              <label className="block">
                <span className="mb-1.5 block text-sm font-medium text-gray-300">Start</span>
                <select
                  className="input w-full"
                  value={startChoice}
                  disabled={routing}
                  onChange={event => { setStartChoice(event.target.value); setRouteError(null) }}
                >
                  <option value="current">📍 Aktuel placering</option>
                  {selectedPins.map((pin, index) => (
                    <option key={pin.id} value={pin.id} disabled={endChoice === pin.id}>
                      Pin {index + 1} · {pin.name}
                    </option>
                  ))}
                </select>
              </label>

              <label className="block">
                <span className="mb-1.5 block text-sm font-medium text-gray-300">Slut</span>
                <select
                  className="input w-full"
                  value={endChoice}
                  disabled={routing}
                  onChange={event => { setEndChoice(event.target.value); setRouteError(null) }}
                >
                  <option value="current">📍 Aktuel placering</option>
                  {selectedPins.map((pin, index) => (
                    <option key={pin.id} value={pin.id} disabled={startChoice === pin.id}>
                      Pin {index + 1} · {pin.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            {routeError && (
              <div className="mt-4 rounded-xl border border-red-900/60 bg-red-950/70 px-3 py-2 text-sm text-red-200">
                {routeError}
              </div>
            )}

            <div className="mt-6 flex justify-end gap-2">
              <button
                type="button"
                disabled={routing}
                onClick={() => setShowRouteSetup(false)}
                className="btn-secondary px-4 py-2.5 disabled:opacity-40"
              >
                Tilbage
              </button>
              <button
                type="button"
                disabled={routing}
                onClick={createOptimizedRoute}
                className="btn-primary px-5 py-2.5 disabled:cursor-wait disabled:opacity-60"
              >
                {routing ? 'Beregner rute…' : 'Lav ruten'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
