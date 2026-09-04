'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import type * as Leaflet from 'leaflet'
import 'leaflet/dist/leaflet.css'
import type { Category, Pin, PinStatus } from '@/types/pin'
import { PIN_STATUSES, PIN_STATUS_COLORS, PIN_STATUS_LABELS } from '@/types/pin'

type MapProvider = 'maptiler' | 'esri'
type EndpointChoice = 'current' | string

interface RouteLeg {
  fromId: string | null
  toId: string | null
  distanceKm: number | null
  durationSeconds: number | null
}

interface StopCoordinate {
  lat: number
  lng: number
}

interface RouteResult {
  optimized: boolean
  orderedStopIds: string[]
  shapes: string[]
  legs: RouteLeg[]
  distanceKm: number | null
  durationSeconds: number | null
  selectedPinIds: string[]
  stopLabels: Record<string, string>
  stopCoordinates: Record<string, StopCoordinate>
}

interface RouteApiResult extends Partial<RouteResult> {
  optimized: boolean
  orderedStopIds: string[]
  shapes: string[]
  legs: RouteLeg[]
  distanceKm: number | null
  durationSeconds: number | null
  error?: string
  failedStopId?: string
}

interface InitialSavedRoute {
  id: string
  name: string
  routeData: RouteResult
}

interface StoredNavProgress {
  destinationIds: string[]
  index: number
  started: boolean
}

interface Props {
  maptilerKey: string
  mapProvider: MapProvider
  geodanmarkAvailable: boolean
  initialPins: Pin[]
  categories: Category[]
  initialSavedRoute?: InitialSavedRoute | null
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

// Faste farver pr. etape. 50 forskellige farver dækker normale ruter uden gentagelser.
const ROUTE_LEG_COLORS = [
  '#f59e0b', '#3b82f6', '#22c55e', '#a855f7', '#ec4899',
  '#06b6d4', '#ef4444', '#eab308', '#14b8a6', '#8b5cf6',
  '#f97316', '#0ea5e9', '#84cc16', '#d946ef', '#f43f5e',
  '#2dd4bf', '#dc2626', '#ca8a04', '#10b981', '#6366f1',
  '#fb7185', '#38bdf8', '#4ade80', '#c084fc', '#f472b6',
  '#67e8f9', '#f87171', '#facc15', '#5eead4', '#818cf8',
  '#c2410c', '#0369a1', '#3f6212', '#7e22ce', '#be123c',
  '#0f766e', '#991b1b', '#a16207', '#047857', '#4338ca',
  '#ea580c', '#0284c7', '#65a30d', '#9333ea', '#db2777',
  '#0891b2', '#b91c1c', '#b45309', '#059669', '#4f46e5',
]

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

function computeDestinationIds(result: RouteResult | null): string[] {
  if (!result) return []
  return result.orderedStopIds.filter(id => id !== CURRENT_START_ID && id !== CURRENT_END_ID)
}

function navStorageKey(savedRouteId: string | null): string {
  return `urbanExplorerNav:${savedRouteId ?? 'draft'}`
}

function loadNavProgress(savedRouteId: string | null): StoredNavProgress | null {
  try {
    const raw = window.localStorage.getItem(navStorageKey(savedRouteId))
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<StoredNavProgress>
    if (!Array.isArray(parsed.destinationIds) || typeof parsed.index !== 'number' || typeof parsed.started !== 'boolean') return null
    return { destinationIds: parsed.destinationIds, index: parsed.index, started: parsed.started }
  } catch {
    return null
  }
}

function saveNavProgress(savedRouteId: string | null, progress: StoredNavProgress) {
  try {
    window.localStorage.setItem(navStorageKey(savedRouteId), JSON.stringify(progress))
  } catch {
    // localStorage utilgængeligt (privat vindue e.l.) - ruten kan stadig bruges, blot uden gemt fremdrift
  }
}

function clearNavProgress(savedRouteId: string | null) {
  try {
    window.localStorage.removeItem(navStorageKey(savedRouteId))
  } catch {
    // se saveNavProgress
  }
}

function googleMapsDirectionsUrl(lat: number, lng: number): string {
  return `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}&travelmode=driving`
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

export default function RoutePlannerMap({
  maptilerKey,
  mapProvider,
  geodanmarkAvailable,
  initialPins,
  categories,
  initialSavedRoute = null,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<Leaflet.Map | null>(null)
  const leafletRef = useRef<typeof Leaflet | null>(null)
  const markerLayerRef = useRef<Leaflet.LayerGroup | null>(null)
  const routeLayerRef = useRef<Leaflet.LayerGroup | null>(null)

  const [mapReady, setMapReady] = useState(false)
  const [selecting, setSelecting] = useState(false)
  const [selectedIds, setSelectedIds] = useState<string[]>(() => initialSavedRoute?.routeData.selectedPinIds ?? [])
  const [routing, setRouting] = useState(false)
  const [routeError, setRouteError] = useState<string | null>(null)
  const [routeResult, setRouteResult] = useState<RouteResult | null>(() => initialSavedRoute?.routeData ?? null)
  const [routePanelCollapsed, setRoutePanelCollapsed] = useState(false)
  const [showRouteSetup, setShowRouteSetup] = useState(false)
  const [startChoice, setStartChoice] = useState<EndpointChoice>('current')
  const [endChoice, setEndChoice] = useState<EndpointChoice>('current')
  const [savedRouteId, setSavedRouteId] = useState<string | null>(initialSavedRoute?.id ?? null)
  const [savedRouteName, setSavedRouteName] = useState<string | null>(initialSavedRoute?.name ?? null)
  const [showSaveRoute, setShowSaveRoute] = useState(false)
  const [saveName, setSaveName] = useState('')
  const [savingRoute, setSavingRoute] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [navStarted, setNavStarted] = useState(false)
  const [navIndex, setNavIndex] = useState(0)
  const [showStartNavModal, setShowStartNavModal] = useState(false)
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

  const destinationIds = useMemo(() => computeDestinationIds(routeResult), [routeResult])

  useEffect(() => {
    if (destinationIds.length === 0) {
      setNavStarted(false)
      setNavIndex(0)
      return
    }

    const stored = loadNavProgress(savedRouteId)
    const matches = stored
      && stored.destinationIds.length === destinationIds.length
      && stored.destinationIds.every((id, index) => id === destinationIds[index])

    if (matches && stored) {
      setNavStarted(stored.started)
      setNavIndex(Math.min(Math.max(stored.index, 0), destinationIds.length))
    } else {
      setNavStarted(false)
      setNavIndex(0)
    }
  }, [savedRouteId, destinationIds])

  function stopLabel(id: string | null): string {
    if (!id) return 'Ukendt stop'
    const snapshotLabel = routeResult?.stopLabels?.[id]
    if (snapshotLabel) return snapshotLabel
    if (id === CURRENT_START_ID || id === CURRENT_END_ID) return 'Aktuel placering'
    return initialPins.find(pin => pin.id === id)?.name || 'Ukendt pin'
  }

  useEffect(() => {
    let cancelled = false
    let zoomMedia: MediaQueryList | null = null
    let updateZoomPosition: (() => void) | null = null

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
        zoomControl: false,
        maxZoom: 22,
        doubleClickZoom: true,
      })

      const zoomControl = L.control.zoom({ position: 'topleft' }).addTo(map)
      zoomMedia = window.matchMedia('(max-width: 767px)')
      updateZoomPosition = () => zoomControl.setPosition(zoomMedia?.matches ? 'topright' : 'topleft')
      updateZoomPosition()
      zoomMedia.addEventListener('change', updateZoomPosition)

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
      if (zoomMedia && updateZoomPosition) zoomMedia.removeEventListener('change', updateZoomPosition)
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
          setSavedRouteId(null)
          setSavedRouteName(null)
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
    if (!L || !map || !layer || !mapReady) return

    layer.clearLayers()
    if (!routeResult) return

    const allPoints: [number, number][] = []
    routeResult.shapes.forEach((shape, index) => {
      const points = decodePolyline6(shape)
      if (points.length < 2) return
      allPoints.push(...points)
      L.polyline(points, {
        color: ROUTE_LEG_COLORS[index % ROUTE_LEG_COLORS.length],
        weight: 6,
        opacity: 0.92,
        lineJoin: 'round',
        lineCap: 'round',
      }).addTo(layer)
    })

    if (allPoints.length > 1) {
      map.fitBounds(L.latLngBounds(allPoints), { padding: [50, 50], maxZoom: 16 })
    }
  }, [routeResult, mapReady])

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
    setRoutePanelCollapsed(false)
    setRouteError(null)
    setSavedRouteId(null)
    setSavedRouteName(null)
    setShowSaveRoute(false)
    setShowRouteSetup(false)
    setSelecting(true)
  }

  function cancelSelecting() {
    setSelecting(false)
    setSelectedIds([])
    setRouteResult(null)
    setRoutePanelCollapsed(false)
    setRouteError(null)
    setSavedRouteId(null)
    setSavedRouteName(null)
    setShowSaveRoute(false)
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

  function labelForStop(stop: RouteStop): string {
    if (stop.id === CURRENT_START_ID || stop.id === CURRENT_END_ID) return 'Aktuel placering'
    return initialPins.find(pin => pin.id === stop.id)?.name || 'Ukendt pin'
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

      const selectedIdSet = new Set(selectedIds)
      const optimizedPins = data.orderedStopIds.filter(id => selectedIdSet.has(id))
      const stopLabels = Object.fromEntries(stops.map(stop => [stop.id, labelForStop(stop)]))
      const stopCoordinates = Object.fromEntries(stops.map(stop => [stop.id, { lat: stop.lat, lng: stop.lng }]))

      const enrichedResult: RouteResult = {
        optimized: data.optimized,
        orderedStopIds: data.orderedStopIds,
        shapes: data.shapes,
        legs: data.legs,
        distanceKm: data.distanceKm,
        durationSeconds: data.durationSeconds,
        selectedPinIds: optimizedPins,
        stopLabels,
        stopCoordinates,
      }

      setRouteResult(enrichedResult)
      setRoutePanelCollapsed(false)
      setSavedRouteId(null)
      setSavedRouteName(null)
      if (optimizedPins.length === selectedIds.length) setSelectedIds(optimizedPins)
      setSelecting(false)
      setShowRouteSetup(false)
    } catch (error) {
      setRouteError(error instanceof Error ? error.message : 'Køreruten kunne ikke beregnes')
    } finally {
      setRouting(false)
    }
  }

  function openSaveRoute() {
    if (!routeResult || savedRouteId) return
    const defaultName = `Rute ${new Date().toLocaleDateString('da-DK')}`
    setSaveName(savedRouteName || defaultName)
    setSaveError(null)
    setShowSaveRoute(true)
  }

  async function saveCurrentRoute() {
    if (!routeResult || savingRoute) return
    const name = saveName.trim()
    if (!name) {
      setSaveError('Giv ruten et navn.')
      return
    }

    setSavingRoute(true)
    setSaveError(null)
    try {
      const response = await fetch('/api/route-planner/saved', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, routeData: routeResult }),
      })
      const data = await response.json() as { id?: string; name?: string; error?: string }
      if (!response.ok || !data.id) throw new Error(data.error || 'Ruten kunne ikke gemmes')

      setSavedRouteId(data.id)
      setSavedRouteName(data.name || name)
      setShowSaveRoute(false)
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : 'Ruten kunne ikke gemmes')
    } finally {
      setSavingRoute(false)
    }
  }

  function openMapsFor(stopId: string) {
    const coords = routeResult?.stopCoordinates?.[stopId]
    if (!coords) return
    window.open(googleMapsDirectionsUrl(coords.lat, coords.lng), '_blank', 'noopener,noreferrer')
  }

  function openStartNavigation() {
    if (destinationIds.length === 0) return
    setShowStartNavModal(true)
  }

  function confirmStartNavigation() {
    if (destinationIds.length === 0) return
    openMapsFor(destinationIds[0])
    const nextIndex = 1
    setNavStarted(true)
    setNavIndex(nextIndex)
    saveNavProgress(savedRouteId, { destinationIds, index: nextIndex, started: true })
    setShowStartNavModal(false)
  }

  function continueNavigation() {
    if (navIndex >= destinationIds.length) return
    openMapsFor(destinationIds[navIndex])
    const nextIndex = navIndex + 1
    setNavIndex(nextIndex)
    saveNavProgress(savedRouteId, { destinationIds, index: nextIndex, started: true })
  }

  function skipCurrentStop() {
    if (navIndex >= destinationIds.length) return
    const nextIndex = navIndex + 1
    setNavIndex(nextIndex)
    saveNavProgress(savedRouteId, { destinationIds, index: nextIndex, started: true })
  }

  function restartNavigation() {
    setNavStarted(false)
    setNavIndex(0)
    clearNavProgress(savedRouteId)
  }

  const duration = formatDuration(routeResult?.durationSeconds ?? null)
  const distanceLabel = formatDistance(routeResult?.distanceKm ?? null)
  const navCompleted = navStarted && navIndex >= destinationIds.length

  return (
    <div className="relative h-[calc(100dvh-4rem)] min-h-[520px] w-full overflow-hidden bg-void-950">
      <div ref={containerRef} className="absolute inset-0" />

      <aside className="absolute left-2 top-2 z-[500] w-28 rounded-xl border border-void-700 bg-void-900/90 p-2 shadow-xl backdrop-blur-sm md:w-32">
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
            <p className="text-sm font-semibold text-gray-100">{savedRouteName || 'Optimeret kørerute'}</p>
            <p className="mt-0.5 text-[11px] text-gray-400">
              {selectedIds.length} valgte pins
              {distanceLabel ? ` · ${distanceLabel}` : ''}
              {duration ? ` · ${duration}` : ''}
            </p>
            {navStarted && (
              <p className="mt-1 text-[11px] font-medium text-rust-400">
                {navCompleted
                  ? 'Rute gennemført 🎉'
                  : `På vej til stop ${navIndex + 1} af ${destinationIds.length}: ${stopLabel(destinationIds[navIndex])}`}
              </p>
            )}
          </div>

          {routeResult.legs.length > 0 && (
            <aside className={`absolute left-2 z-[650] overflow-hidden rounded-xl border border-void-700 bg-void-900/95 shadow-xl backdrop-blur-sm transition-[width] ${routePanelCollapsed ? 'bottom-20 w-[190px] md:bottom-4' : 'bottom-20 max-h-[55vh] w-[calc(100vw-1rem)] max-w-[340px] md:bottom-4'}`}>
              <div className={`flex items-center justify-between gap-3 bg-void-900/95 px-3 py-2.5 ${routePanelCollapsed ? '' : 'border-b border-void-700'}`}>
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-gray-100">Rute</p>
                  <p className="text-[11px] text-gray-500">{routeResult.legs.length} etaper</p>
                </div>
                <button
                  type="button"
                  onClick={() => setRoutePanelCollapsed(previous => !previous)}
                  aria-expanded={!routePanelCollapsed}
                  aria-label={routePanelCollapsed ? 'Åbn ruteoversigt' : 'Minimér ruteoversigt'}
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-void-700 bg-void-800 text-lg font-bold text-gray-300 hover:bg-void-700 hover:text-white"
                >
                  {routePanelCollapsed ? '⌃' : '⌄'}
                </button>
              </div>

              {!routePanelCollapsed && (
                <div className="max-h-[calc(55vh-58px)] divide-y divide-void-700/70 overflow-y-auto">
                  {routeResult.legs.map((leg, index) => {
                    const legDuration = formatDuration(leg.durationSeconds)
                    const legDistance = formatDistance(leg.distanceKm)
                    const legColor = ROUTE_LEG_COLORS[index % ROUTE_LEG_COLORS.length]
                    return (
                      <div key={`${leg.fromId}-${leg.toId}-${index}`} className="flex gap-3 px-3 py-3">
                        <div className="flex w-7 shrink-0 flex-col items-center gap-1.5 pt-0.5">
                          <span
                            className="h-1 w-7 rounded-full shadow-sm"
                            style={{ backgroundColor: legColor }}
                            aria-hidden="true"
                          />
                          <div className="flex h-6 w-6 items-center justify-center rounded-full bg-void-700 text-[11px] font-bold text-gray-200">
                            {index + 1}
                          </div>
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="text-[12px] font-medium leading-4 text-gray-200">
                            <span className="break-words">{stopLabel(leg.fromId)}</span>
                            <span className="mx-1.5 text-gray-500">→</span>
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
              )}
            </aside>
          )}
        </>
      )}

      {routeError && !showRouteSetup && (
        <div className="absolute bottom-24 left-1/2 z-[700] w-[min(90vw,520px)] -translate-x-1/2 rounded-xl border border-red-900/60 bg-red-950/90 px-4 py-3 text-center text-sm text-red-200 shadow-xl">
          {routeError}
        </div>
      )}

      <div className="absolute bottom-5 left-1/2 z-[700] flex max-w-[calc(100vw-1rem)] -translate-x-1/2 flex-wrap items-center justify-center gap-2">
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
          <>
            {!navStarted && (
              <button type="button" onClick={openStartNavigation} className="btn-primary whitespace-nowrap px-5 py-3 shadow-xl">
                Start rute
              </button>
            )}

            {navStarted && !navCompleted && (
              <>
                <button type="button" onClick={continueNavigation} className="btn-primary whitespace-nowrap px-5 py-3 shadow-xl">
                  Naviger til {stopLabel(destinationIds[navIndex])}
                </button>
                <button type="button" onClick={skipCurrentStop} className="btn-secondary whitespace-nowrap px-4 py-3 shadow-xl">
                  Spring pin over
                </button>
              </>
            )}

            {navCompleted && (
              <button type="button" onClick={restartNavigation} className="btn-secondary whitespace-nowrap px-4 py-3 shadow-xl">
                Start rute forfra
              </button>
            )}

            <button
              type="button"
              onClick={openSaveRoute}
              disabled={Boolean(savedRouteId)}
              className="btn-secondary whitespace-nowrap px-4 py-3 shadow-xl disabled:cursor-default disabled:opacity-70"
            >
              {savedRouteId ? '✓ Rute gemt' : 'Gem rute'}
            </button>
            <button type="button" onClick={startSelecting} className="btn-secondary whitespace-nowrap px-4 py-3 shadow-xl">
              Vælg pins igen
            </button>
          </>
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
                className="btn-primary flex min-w-[170px] items-center justify-center gap-2 px-5 py-2.5 disabled:cursor-wait disabled:opacity-60"
              >
                {routing ? (
                  <>
                    <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" aria-hidden="true" />
                    <span>Beregner rute…</span>
                  </>
                ) : 'Lav ruten'}
              </button>
            </div>
          </div>
        </div>
      )}

      {showStartNavModal && routeResult && destinationIds.length > 0 && (
        <div
          className="fixed inset-0 z-[2200] flex items-center justify-center bg-black/65 px-4"
          onClick={() => setShowStartNavModal(false)}
        >
          <div
            className="w-full max-w-md rounded-2xl border border-void-700 bg-void-900 p-5 shadow-2xl"
            onClick={event => event.stopPropagation()}
          >
            <div className="mb-5 flex items-start justify-between gap-4">
              <div>
                <h2 className="text-lg font-semibold text-gray-100">Start rute</h2>
                <p className="mt-1 text-sm text-gray-400">
                  Navigationen starter til første stop: <span className="font-medium text-gray-200">{stopLabel(destinationIds[0])}</span>.
                  Google Maps åbner i en ny fane. Kom tilbage hertil undervejs, så ved appen automatisk hvilket stop der er næste i rækken.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowStartNavModal(false)}
                className="text-2xl leading-none text-gray-500 hover:text-gray-200"
              >
                ×
              </button>
            </div>

            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setShowStartNavModal(false)} className="btn-secondary px-4 py-2.5">
                Annuller
              </button>
              <button type="button" onClick={confirmStartNavigation} className="btn-primary px-5 py-2.5">
                Åbn i Google Maps
              </button>
            </div>
          </div>
        </div>
      )}

      {showSaveRoute && routeResult && (
        <div
          className="fixed inset-0 z-[2100] flex items-center justify-center bg-black/65 px-4"
          onClick={() => { if (!savingRoute) setShowSaveRoute(false) }}
        >
          <div
            className="w-full max-w-md rounded-2xl border border-void-700 bg-void-900 p-5 shadow-2xl"
            onClick={event => event.stopPropagation()}
          >
            <div className="mb-5 flex items-start justify-between gap-4">
              <div>
                <h2 className="text-lg font-semibold text-gray-100">Gem rute</h2>
                <p className="mt-1 text-sm text-gray-400">Ruten gemmes under Gemte ruter og kan indlæses igen senere.</p>
              </div>
              <button
                type="button"
                disabled={savingRoute}
                onClick={() => setShowSaveRoute(false)}
                className="text-2xl leading-none text-gray-500 hover:text-gray-200 disabled:opacity-40"
              >
                ×
              </button>
            </div>

            <label className="block">
              <span className="mb-1.5 block text-sm font-medium text-gray-300">Rutenavn</span>
              <input
                type="text"
                maxLength={100}
                autoFocus
                value={saveName}
                disabled={savingRoute}
                onChange={event => { setSaveName(event.target.value); setSaveError(null) }}
                onKeyDown={event => {
                  if (event.key === 'Enter' && !savingRoute) void saveCurrentRoute()
                }}
                className="input w-full"
                placeholder="Fx Søndagstur på Lolland"
              />
            </label>

            {saveError && (
              <div className="mt-4 rounded-xl border border-red-900/60 bg-red-950/70 px-3 py-2 text-sm text-red-200">
                {saveError}
              </div>
            )}

            <div className="mt-6 flex justify-end gap-2">
              <button
                type="button"
                disabled={savingRoute}
                onClick={() => setShowSaveRoute(false)}
                className="btn-secondary px-4 py-2.5 disabled:opacity-40"
              >
                Annuller
              </button>
              <button
                type="button"
                disabled={savingRoute}
                onClick={() => void saveCurrentRoute()}
                className="btn-primary flex min-w-[135px] items-center justify-center gap-2 px-5 py-2.5 disabled:cursor-wait disabled:opacity-60"
              >
                {savingRoute ? (
                  <>
                    <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" aria-hidden="true" />
                    <span>Gemmer…</span>
                  </>
                ) : 'Gem rute'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
