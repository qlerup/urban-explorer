'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import type * as Leaflet from 'leaflet'
import 'leaflet/dist/leaflet.css'
import type { Category, Pin, PinRoute, PinStatus, RoutePoint, SharedWorkspace } from '@/types/pin'
import { PIN_STATUSES, PIN_STATUS_LABELS, PIN_STATUS_COLORS } from '@/types/pin'
import PinModal from './PinModal'
import SharePickerModal from './SharePickerModal'
import UserShareModal from './UserShareModal'
import SaveRouteModal from './SaveRouteModal'

interface GridCellData {
  row: number
  col: number
}

interface CadastralParcelInfo {
  ogcFid?: string
  label?: string
  nationalCadastralReference?: string
  areaValue?: number
  inspireId?: string
  validFrom?: string
  basicPropertyUnitId?: string
  administrativeUnitCode?: string
  cadastralZoningReference?: string
  cadastralParcelId?: string
}

interface CadastralZoningInfo {
  label?: string
  reference?: string
  levelName?: string
  validFrom?: string
  originalMapScaleDenominator?: number
}

type CadastralInfoState =
  | { status: 'loading' }
  | { status: 'found'; parcel: CadastralParcelInfo; zoning?: CadastralZoningInfo | null }
  | { status: 'empty' }
  | { status: 'error'; message: string }

type ClipboardCopyState =
  | { status: 'copied'; value: string }
  | { status: 'failed'; value: string }

interface Props {
  maptilerKey: string
  initialPins: Pin[]
  categories: Category[]
  sharedWorkspaces?: SharedWorkspace[]
  initialGridCells?: GridCellData[]
  focusPinId?: string
  readOnly?: boolean
}

const DEFAULT_CENTER: [number, number] = [55.5, 10.4]
const DEFAULT_ZOOM = 6.5
const MAP_MAX_NATIVE_ZOOM = 20
const MAP_MAX_ZOOM = 22
const NO_CATEGORY = '__none__'

// Filter-nøgle for ukategoriserede pins delt af en anden bruger
function sharedUncatKey(ownerId: string): string {
  return `__shared_none__:${ownerId}`
}

function pinCategoryKey(pin: Pin): string {
  if (pin.category) return pin.category.id
  return pin.ownerId ? sharedUncatKey(pin.ownerId) : NO_CATEGORY
}
type MapLayerId = 'satellite-v4' | 'hybrid-v4' | 'outdoor-v4'
interface MapLayerPreviewTile {
  x: number
  y: number
  z: number
}

const MAP_LAYERS: { id: MapLayerId; label: string }[] = [
  { id: 'satellite-v4', label: 'Satellit' },
  { id: 'hybrid-v4', label: 'Vejnavne' },
  { id: 'outdoor-v4', label: 'Outdoor' },
]

const MAP_ATTRIBUTION =
  '&copy; <a href="https://www.maptiler.com/copyright/" target="_blank" rel="noopener noreferrer">MapTiler</a> ' +
  '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap contributors</a>'

function mapLayerTileUrl(layerId: MapLayerId, maptilerKey: string): string {
  if (layerId === 'hybrid-v4') {
    return `https://api.maptiler.com/maps/hybrid-v4/256/{z}/{x}/{y}.jpg?key=${maptilerKey}`
  }
  if (layerId === 'outdoor-v4') {
    return `https://api.maptiler.com/maps/outdoor-v4/256/{z}/{x}/{y}.png?key=${maptilerKey}`
  }
  return `https://api.maptiler.com/maps/satellite-v4/256/{z}/{x}/{y}.jpg?key=${maptilerKey}`
}

function latLngToTile(lat: number, lng: number, zoom: number): MapLayerPreviewTile {
  const n = 2 ** zoom
  const x = Math.floor(((lng + 180) / 360) * n)
  const latRad = (lat * Math.PI) / 180
  const y = Math.floor(((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n)
  return { x, y, z: zoom }
}

function mapLayerPreviewUrl(layerId: MapLayerId, maptilerKey: string, tile: MapLayerPreviewTile): string {
  return mapLayerTileUrl(layerId, maptilerKey)
    .replace('{z}', String(tile.z))
    .replace('{x}', String(tile.x))
    .replace('{y}', String(tile.y))
}

// Modul-niveau i stedet for state, så visningen husker sig selv når man navigerer
// væk fra og tilbage til kortsiden (fx via "Mine pins"), i stedet for at nulstille.
let lastMapView: { center: [number, number]; zoom: number } | null = null
let lastMapLayerId: MapLayerId = 'satellite-v4'
let lastGridEnabled = false
let lastCadastralEnabled = false

// 1x1km gitter. Bredde/højdegrad for 1km beregnes ud fra en fast reference-breddegrad
// (ca. midten af Danmark), så gitteret er stabilt og fliserne stemmer overens med
// hinanden, uanset hvor på kortet man kigger - i stedet for at regne det ud fra det
// aktuelle synsfelt, hvilket ville flytte fliserne hver gang man panorerer op/ned.
const GRID_CELL_KM = 1
const GRID_REF_LAT_DEG = 56
const GRID_LAT_STEP_DEG = GRID_CELL_KM / 111.32
const GRID_LNG_STEP_DEG = GRID_CELL_KM / (111.32 * Math.cos((GRID_REF_LAT_DEG * Math.PI) / 180))
const GRID_MIN_ZOOM = 12
const GRID_MAX_CELLS = 4000
const GRID_DOUBLE_ACTIVATE_MS = 500
const CADASTRAL_WMS_URL = 'https://api.dataforsyningen.dk/wms/cp_inspire'
const CADASTRAL_LAYER = 'CP.CadastralParcel'
const CADASTRAL_MIN_ZOOM = 15
const CADASTRAL_ATTRIBUTION =
  '&copy; <a href="https://dataforsyningen.dk/" target="_blank" rel="noopener noreferrer">Dataforsyningen</a>'

interface GridCellCoord {
  row: number
  col: number
}

function gridCellForLatLng(lat: number, lng: number): GridCellCoord {
  return {
    row: Math.floor(lat / GRID_LAT_STEP_DEG),
    col: Math.floor(lng / GRID_LNG_STEP_DEG),
  }
}

function gridCellBounds(row: number, col: number): { south: number; north: number; west: number; east: number } {
  const south = row * GRID_LAT_STEP_DEG
  const west = col * GRID_LNG_STEP_DEG
  return { south, north: south + GRID_LAT_STEP_DEG, west, east: west + GRID_LNG_STEP_DEG }
}

function gridCellKey(row: number, col: number): string {
  return `${row}_${col}`
}

interface SearchCoordinates {
  lat: number
  lng: number
}

interface GeocodingFeature {
  center?: [number, number]
  bbox?: [number, number, number, number]
}

interface GeocodingResponse {
  features?: GeocodingFeature[]
}

function numberFromCoordinatePart(value: string | undefined): number {
  if (!value) return 0
  return Number(value.replace(',', '.'))
}

function parseDmsCoordinateSearch(input: string): SearchCoordinates | null {
  const pattern = /([+-]?\d+(?:[.,]\d+)?)\s*[°º]\s*(?:(\d+(?:[.,]\d+)?)\s*['′’]?)?\s*(?:(\d+(?:[.,]\d+)?)\s*(?:"|″|”|''|s)?)?\s*([NSEW])/gi
  const parts = Array.from(input.matchAll(pattern)).map(match => {
    const degrees = numberFromCoordinatePart(match[1])
    const minutes = numberFromCoordinatePart(match[2])
    const seconds = numberFromCoordinatePart(match[3])
    const direction = match[4].toUpperCase()
    const absolute = Math.abs(degrees) + minutes / 60 + seconds / 3600
    const value = direction === 'S' || direction === 'W' || degrees < 0 ? -absolute : absolute
    return { direction, value }
  })

  if (parts.length !== 2) return null

  const latPart = parts.find(part => part.direction === 'N' || part.direction === 'S')
  const lngPart = parts.find(part => part.direction === 'E' || part.direction === 'W')
  if (!latPart || !lngPart) return null
  if (Math.abs(latPart.value) > 90 || Math.abs(lngPart.value) > 180) return null

  return { lat: latPart.value, lng: lngPart.value }
}

function formatDistance(meters: number): string {
  if (meters < 1000) return `${Math.round(meters)} m`
  return `${(meters / 1000).toFixed(2)} km`
}

function formatArea(squareMeters: number): string {
  return `${new Intl.NumberFormat('da-DK').format(squareMeters)} m2`
}

function formatDateTime(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('da-DK', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(date)
}

async function copyTextToClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    // Fallback below handles browsers without Clipboard API access.
  }

  const textarea = document.createElement('textarea')
  textarea.value = text
  textarea.readOnly = true
  textarea.setAttribute('aria-hidden', 'true')
  textarea.style.position = 'fixed'
  textarea.style.top = '0'
  textarea.style.left = '0'
  textarea.style.width = '1px'
  textarea.style.height = '1px'
  textarea.style.opacity = '0'
  textarea.style.pointerEvents = 'none'
  document.body.appendChild(textarea)

  try {
    textarea.focus({ preventScroll: true })
    textarea.select()
    textarea.setSelectionRange(0, text.length)
    return document.execCommand('copy')
  } catch {
    return false
  } finally {
    document.body.removeChild(textarea)
  }
}

function parseCoordinateSearch(input: string): SearchCoordinates | null {
  const dms = parseDmsCoordinateSearch(input)
  if (dms) return dms

  const matches = input
    .trim()
    .replace(/[()]/g, ' ')
    .match(/[-+]?\d+(?:[.,]\d+)?/g)

  if (!matches || matches.length !== 2) return null

  const [first, second] = matches.map(value => Number(value.replace(',', '.')))
  if (!Number.isFinite(first) || !Number.isFinite(second)) return null

  if (Math.abs(first) <= 90 && Math.abs(second) <= 180) {
    return { lat: first, lng: second }
  }

  if (Math.abs(first) <= 180 && Math.abs(second) <= 90) {
    return { lat: second, lng: first }
  }

  return null
}

export default function MapView({ maptilerKey, initialPins, categories, sharedWorkspaces = [], initialGridCells, focusPinId, readOnly }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<Leaflet.Map | null>(null)
  const leafletRef = useRef<typeof Leaflet | null>(null)
  const markersRef = useRef<globalThis.Map<string, Leaflet.Marker>>(new globalThis.Map())
  const baseLayerRef = useRef<Leaflet.TileLayer | null>(null)
  const searchMarkerRef = useRef<Leaflet.CircleMarker | null>(null)
  const locateMarkerRef = useRef<Leaflet.Marker | null>(null)
  const nativeDblClickCleanupRef = useRef<(() => void) | null>(null)
  const lastPointerTypeRef = useRef<string>('mouse')
  const lastGridClickRef = useRef<{ key: string; time: number } | null>(null)
  const workspaceCanEditRef = useRef(true)
  const measureLayerRef = useRef<Leaflet.LayerGroup | null>(null)
  const viewRouteLayerRef = useRef<Leaflet.LayerGroup | null>(null)
  const gridLayerRef = useRef<Leaflet.LayerGroup | null>(null)
  const cadastralLayerRef = useRef<Leaflet.TileLayer | null>(null)
  const cadastralHighlightLayerRef = useRef<Leaflet.ImageOverlay | null>(null)
  const measureModeRef = useRef<'measure' | 'route' | null>(null)
  const cadastralRequestIdRef = useRef(0)
  const [mapReady, setMapReady] = useState(false)
  const [pins, setPins] = useState<Pin[]>(initialPins)
  const [activeWorkspaceOwnerId, setActiveWorkspaceOwnerId] = useState<string | null>(
    () => initialPins.find(pin => pin.id === focusPinId)?.ownerId ?? null
  )
  const [newPinCoords, setNewPinCoords] = useState<{ lat: number; lng: number } | null>(null)
  const [pendingCenter, setPendingCenter] = useState<{ purpose: 'new-pin' | 'route-point' } | null>(null)
  const [measureMode, setMeasureMode] = useState<'measure' | 'route' | null>(null)
  const [measurePoints, setMeasurePoints] = useState<RoutePoint[]>([])
  const [showRoutePicker, setShowRoutePicker] = useState(false)
  const [editingRoute, setEditingRoute] = useState<{ pinId: string; routeId: string } | null>(null)
  const [viewingRouteId, setViewingRouteId] = useState<string | null>(null)
  const [activeCategoryIds, setActiveCategoryIds] = useState<Set<string>>(
    () => new Set([
      ...categories.map(c => c.id),
      NO_CATEGORY,
      // Ukategoriserede pins delt med dig: én chip pr. ejer, tændt fra start
      ...initialPins.filter(p => p.ownerId && !p.category).map(p => sharedUncatKey(p.ownerId!)),
    ])
  )
  const [activeStatuses, setActiveStatuses] = useState<Set<PinStatus>>(() => new Set(PIN_STATUSES))
  const [activeRatings, setActiveRatings] = useState<Set<number>>(() => new Set([0, 1, 2, 3]))
  const [sharePickerOpen, setSharePickerOpen] = useState(false)
  const [userShareOpen, setUserShareOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [searching, setSearching] = useState(false)
  const [searchError, setSearchError] = useState<string | null>(null)
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false)
  const [pinsVisible, setPinsVisible] = useState(true)
  const [mapLayerId, setMapLayerId] = useState<MapLayerId>(() => lastMapLayerId)
  const [layerPickerOpen, setLayerPickerOpen] = useState(false)
  const [mobileLayersOpen, setMobileLayersOpen] = useState(false)
  const [previewTile, setPreviewTile] = useState<MapLayerPreviewTile | null>(null)
  const [gridEnabled, setGridEnabled] = useState(() => lastGridEnabled)
  const [cadastralEnabled, setCadastralEnabled] = useState(() => lastCadastralEnabled)
  const [cadastralInfo, setCadastralInfo] = useState<CadastralInfoState | null>(null)
  const [selectedCadastralFeatureId, setSelectedCadastralFeatureId] = useState<string | null>(null)
  const [cadastralCopyState, setCadastralCopyState] = useState<ClipboardCopyState | null>(null)
  const [gridZoom, setGridZoom] = useState<number>(DEFAULT_ZOOM)
  const [searchedCells, setSearchedCells] = useState<Set<string>>(
    () => new Set((initialGridCells ?? []).map(c => gridCellKey(c.row, c.col)))
  )

  const focusPin = focusPinId ? initialPins.find(p => p.id === focusPinId) ?? null : null
  const [selectedPin, setSelectedPin] = useState<Pin | null>(focusPin)
  const selectedMapLayer = MAP_LAYERS.find(layer => layer.id === mapLayerId) ?? MAP_LAYERS[0]

  const ownCategories = categories.filter(c => !c.ownerId)
  const activeWorkspace = activeWorkspaceOwnerId
    ? sharedWorkspaces.find(workspace => workspace.ownerId === activeWorkspaceOwnerId) ?? null
    : null
  const workspaceCanEdit = !activeWorkspaceOwnerId || activeWorkspace?.canEdit === true
  const workspaceAllowsUncategorized = !activeWorkspaceOwnerId || activeWorkspace?.uncategorized === true
  const workspaceCanCreateUncategorized = !activeWorkspaceOwnerId || activeWorkspace?.canEditUncategorized === true
  const workspaceCategories = categories.filter(category =>
    activeWorkspaceOwnerId ? category.ownerId === activeWorkspaceOwnerId : !category.ownerId
  )
  const workspacePins = pins.filter(pin =>
    activeWorkspaceOwnerId ? pin.ownerId === activeWorkspaceOwnerId : !pin.ownerId
  )
  workspaceCanEditRef.current = workspaceCanEdit

  function toggleCategory(id: string) {
    setActiveCategoryIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  function selectWorkspace(ownerId: string | null) {
    setActiveWorkspaceOwnerId(ownerId)
    setActiveCategoryIds(prev => {
      const next = new Set(prev)
      if (ownerId) next.add(sharedUncatKey(ownerId)); else next.add(NO_CATEGORY)
      categories
        .filter(category => ownerId ? category.ownerId === ownerId : !category.ownerId)
        .forEach(category => next.add(category.id))
      return next
    })
    setSelectedPin(null)
    setNewPinCoords(null)
    setPendingCenter(null)
  }

  function toggleStatus(s: PinStatus) {
    setActiveStatuses(prev => {
      const next = new Set(prev)
      if (next.has(s)) next.delete(s); else next.add(s)
      return next
    })
  }

  function toggleRating(r: number) {
    setActiveRatings(prev => {
      const next = new Set(prev)
      if (next.has(r)) next.delete(r); else next.add(r)
      return next
    })
  }

  function handleSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const trimmed = searchQuery.trim()
    if (!trimmed) return

    setSearching(true)
    setSearchError(null)
    void handleMapSearch(trimmed)
  }

  function confirmPendingCenter() {
    const map = mapRef.current
    if (!map || !pendingCenter) return
    const center = map.getCenter()
    if (pendingCenter.purpose === 'new-pin') {
      if (!workspaceCanEditRef.current) return
      setNewPinCoords({ lat: center.lat, lng: center.lng })
    } else {
      setMeasurePoints(prev => [...prev, { lat: center.lat, lng: center.lng }])
    }
    setPendingCenter(null)
  }

  function cancelPendingCenter() {
    setPendingCenter(null)
  }

  function toggleMeasureMode(mode: 'measure' | 'route') {
    if (mode === 'route' && !workspaceCanEdit) return
    setMeasureMode(prev => (prev === mode ? null : mode))
    setMeasurePoints([])
    setShowRoutePicker(false)
    setEditingRoute(null)
    setPendingCenter(null)
    setSelectedPin(null)
    setNewPinCoords(null)
  }

  function clearMeasurement() {
    setMeasurePoints([])
  }

  async function handleSaveRoute() {
    if (!editingRoute) {
      setShowRoutePicker(true)
      return
    }
    try {
      const res = await fetch(`/api/pins/${editingRoute.pinId}/rute/${editingRoute.routeId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ points: measurePoints }),
      })
      const data = await res.json()
      if (!res.ok) {
        alert(data.error || 'Kunne ikke gemme rute')
        return
      }
      setPins(prev => prev.map(p => (
        p.id === editingRoute.pinId
          ? { ...p, routes: p.routes.map(r => (r.id === editingRoute.routeId ? { ...r, points: data.route.points, distanceMeters: data.route.distanceMeters } : r)) }
          : p
      )))
      setMeasureMode(null)
      setMeasurePoints([])
      setEditingRoute(null)
    } catch {
      alert('Kunne ikke gemme rute')
    }
  }

  function togglePinsVisible() {
    if (pinsVisible) setSelectedPin(null)
    setPinsVisible(prev => !prev)
  }

  function showUserLocation(lat: number, lng: number) {
    const map = mapRef.current
    const L = leafletRef.current
    if (!map || !L) return
    locateMarkerRef.current?.remove()
    const icon = L.divIcon({
      className: '',
      html: '<div class="ue-locate-dot"><span></span></div>',
      iconSize: [18, 18],
      iconAnchor: [9, 9],
    })
    locateMarkerRef.current = L.marker([lat, lng], { icon, interactive: false }).addTo(map)
    map.setView([lat, lng], Math.max(map.getZoom(), 16))
  }

  function locateUser() {
    if (!navigator.geolocation) return
    navigator.geolocation.getCurrentPosition(pos => {
      showUserLocation(pos.coords.latitude, pos.coords.longitude)
    })
  }

  function chooseMapLayer(layerId: MapLayerId) {
    lastMapLayerId = layerId
    setMapLayerId(layerId)
    setLayerPickerOpen(false)
  }

  function toggleGridEnabled() {
    lastGridClickRef.current = null
    setGridEnabled(prev => {
      lastGridEnabled = !prev
      return !prev
    })
  }

  function toggleCadastralEnabled() {
    setCadastralInfo(null)
    setSelectedCadastralFeatureId(null)
    setCadastralCopyState(null)
    setCadastralEnabled(prev => {
      lastCadastralEnabled = !prev
      return !prev
    })
  }

  async function copyCadastralBfe(value: string) {
    const copied = await copyTextToClipboard(value)
    setCadastralCopyState({
      status: copied ? 'copied' : 'failed',
      value,
    })
  }

  async function loadCadastralParcelInfo(event: Leaflet.LeafletMouseEvent) {
    const map = mapRef.current
    if (!map || measureModeRef.current) return

    const requestId = ++cadastralRequestIdRef.current
    setCadastralInfo({ status: 'loading' })
    setSelectedCadastralFeatureId(null)
    setCadastralCopyState(null)

    try {
      const bounds = map.getBounds()
      const crs = map.options.crs
      if (!crs) throw new Error('Kortprojektion mangler')
      const southWest = crs.project(bounds.getSouthWest())
      const northEast = crs.project(bounds.getNorthEast())
      const size = map.getSize()
      const point = map.latLngToContainerPoint(event.latlng)
      const url = new URL('/api/cadastre', window.location.origin)
      url.searchParams.set('bbox', [southWest.x, southWest.y, northEast.x, northEast.y].join(','))
      url.searchParams.set('width', String(Math.round(size.x)))
      url.searchParams.set('height', String(Math.round(size.y)))
      url.searchParams.set('x', String(Math.round(point.x)))
      url.searchParams.set('y', String(Math.round(point.y)))

      const res = await fetch(url)
      const data = (await res.json()) as { parcel?: CadastralParcelInfo | null; zoning?: CadastralZoningInfo | null; error?: string }
      if (requestId !== cadastralRequestIdRef.current) return
      if (!res.ok) throw new Error(data.error || 'Kunne ikke hente matrikelinfo')

      setSelectedCadastralFeatureId(data.parcel?.ogcFid ?? null)
      setCadastralInfo(data.parcel ? { status: 'found', parcel: data.parcel, zoning: data.zoning } : { status: 'empty' })
      if (data.parcel?.basicPropertyUnitId) {
        const copied = await copyTextToClipboard(data.parcel.basicPropertyUnitId)
        if (requestId !== cadastralRequestIdRef.current) return
        setCadastralCopyState({
          status: copied ? 'copied' : 'failed',
          value: data.parcel.basicPropertyUnitId,
        })
      }
    } catch (error) {
      if (requestId !== cadastralRequestIdRef.current) return
      setSelectedCadastralFeatureId(null)
      setCadastralCopyState(null)
      setCadastralInfo({
        status: 'error',
        message: error instanceof Error ? error.message : 'Kunne ikke hente matrikelinfo',
      })
    }
  }

  function shouldToggleGridCellFromClick(key: string) {
    const now = typeof performance === 'undefined' ? Date.now() : performance.now()
    const lastClick = lastGridClickRef.current
    const isDoubleActivation = !!lastClick && lastClick.key === key && now - lastClick.time <= GRID_DOUBLE_ACTIVATE_MS
    lastGridClickRef.current = isDoubleActivation ? null : { key, time: now }
    return isDoubleActivation
  }

  async function toggleGridCell(row: number, col: number) {
    if (readOnly || !workspaceCanEdit) return
    const key = gridCellKey(row, col)
    const willBeSearched = !searchedCells.has(key)
    setSearchedCells(prev => {
      const next = new Set(prev)
      if (willBeSearched) next.add(key); else next.delete(key)
      return next
    })
    try {
      const res = await fetch('/api/grid', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ row, col, searched: willBeSearched, ownerId: activeWorkspaceOwnerId }),
      })
      if (!res.ok) throw new Error('Kunne ikke gemme feltet')
    } catch {
      setSearchedCells(prev => {
        const next = new Set(prev)
        if (willBeSearched) next.delete(key); else next.add(key)
        return next
      })
    }
  }

  function updateLayerPreview(map: Leaflet.Map) {
    const center = map.getCenter()
    const zoom = Math.min(MAP_MAX_NATIVE_ZOOM, Math.max(0, Math.floor(map.getZoom())))
    setPreviewTile(latLngToTile(center.lat, center.lng, zoom))
  }

  function focusSearchResult(lat: number, lng: number, bbox?: [number, number, number, number]) {
    const map = mapRef.current
    const L = leafletRef.current
    if (!map || !L) throw new Error('Kortet er ikke klar endnu')

    searchMarkerRef.current?.remove()
    searchMarkerRef.current = L.circleMarker([lat, lng], {
      radius: 12,
      color: '#f2a65a',
      weight: 3,
      fillColor: '#e08a3c',
      fillOpacity: 0.25,
    }).addTo(map)

    if (bbox && bbox.every(Number.isFinite)) {
      const [west, south, east, north] = bbox
      map.fitBounds(
        [
          [south, west],
          [north, east],
        ],
        { padding: [70, 70], maxZoom: 16 }
      )
      return
    }

    map.flyTo([lat, lng], Math.max(map.getZoom(), 16), { duration: 0.8 })
  }

  async function handleMapSearch(query: string) {
    try {
      const coords = parseCoordinateSearch(query)
      if (coords) {
        focusSearchResult(coords.lat, coords.lng)
        setSearchError(null)
        return
      }

      const url = new URL(`https://api.maptiler.com/geocoding/${encodeURIComponent(query)}.json`)
      url.searchParams.set('key', maptilerKey)
      url.searchParams.set('limit', '1')
      url.searchParams.set('language', 'da')

      const res = await fetch(url)
      if (!res.ok) throw new Error('Adresseopslag fejlede')

      const data = (await res.json()) as GeocodingResponse
      const feature = data.features?.[0]
      const center = feature?.center
      if (!center || center.length < 2) throw new Error('Ingen resultater')

      const [lng, lat] = center
      focusSearchResult(lat, lng, feature.bbox)
      setSearchError(null)
    } catch (error) {
      setSearchError(error instanceof Error ? error.message : 'Kunne ikke finde stedet')
    } finally {
      setSearching(false)
    }
  }

  const visiblePins = useMemo(
    () => {
      if (!pinsVisible) return []
      return workspacePins.filter(pin => {
        const catKey = pinCategoryKey(pin)
        return activeCategoryIds.has(catKey) && activeStatuses.has(pin.status) && activeRatings.has(pin.rating)
      })
    },
    [workspacePins, pinsVisible, activeCategoryIds, activeStatuses, activeRatings]
  )

  useEffect(() => {
    let cancelled = false
    const query = activeWorkspaceOwnerId ? `?ownerId=${encodeURIComponent(activeWorkspaceOwnerId)}` : ''
    void fetch(`/api/grid${query}`)
      .then(async response => {
        if (!response.ok) throw new Error('Kunne ikke hente gitter')
        return response.json()
      })
      .then(data => {
        if (cancelled) return
        const cells = Array.isArray(data.cells) ? data.cells as GridCellData[] : []
        setSearchedCells(new Set(cells.map(cell => gridCellKey(cell.row, cell.col))))
      })
      .catch(() => {
        if (!cancelled) setSearchedCells(new Set())
      })
    return () => { cancelled = true }
  }, [activeWorkspaceOwnerId])

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return
    let cancelled = false

    import('leaflet').then(leafletModule => {
      if (cancelled || !containerRef.current || mapRef.current) return
      const L = (leafletModule as unknown as { default?: typeof Leaflet }).default ?? (leafletModule as unknown as typeof Leaflet)
      leafletRef.current = L

      const map = L.map(containerRef.current, {
        center: focusPin ? [focusPin.latitude, focusPin.longitude] : lastMapView?.center ?? DEFAULT_CENTER,
        zoom: focusPin ? 17 : lastMapView?.zoom ?? DEFAULT_ZOOM,
        maxZoom: MAP_MAX_ZOOM,
        zoomControl: false,
        doubleClickZoom: false,
      })

      map.on('moveend', () => {
        const c = map.getCenter()
        lastMapView = { center: [c.lat, c.lng], zoom: map.getZoom() }
        updateLayerPreview(map)
        setGridZoom(map.getZoom())
      })
      map.on('zoomend', () => {
        updateLayerPreview(map)
        setGridZoom(map.getZoom())
      })
      updateLayerPreview(map)
      setGridZoom(map.getZoom())

      baseLayerRef.current = L.tileLayer(mapLayerTileUrl(mapLayerId, maptilerKey), {
        attribution: MAP_ATTRIBUTION,
        tileSize: 256,
        maxNativeZoom: MAP_MAX_NATIVE_ZOOM,
        maxZoom: MAP_MAX_ZOOM,
        crossOrigin: true,
      }).addTo(map)

      L.control.zoom({ position: 'topright' }).addTo(map)

      const LocateControl = L.Control.extend({
        onAdd: () => {
          const btn = L.DomUtil.create('button', 'leaflet-bar ue-locate-btn')
          btn.type = 'button'
          btn.title = 'Find min position'
          btn.innerHTML = '🎯'
          L.DomEvent.on(btn, 'click', L.DomEvent.stop).on(btn, 'click', () => {
            locateUser()
          })
          return btn
        },
      })
      new LocateControl({ position: 'topright' }).addTo(map)

      if (!readOnly) {
        const makeModeToggleControl = (mode: 'measure' | 'route', title: string, glyph: string) =>
          L.Control.extend({
            onAdd: () => {
              const btn = L.DomUtil.create('button', 'leaflet-bar ue-locate-btn')
              btn.type = 'button'
              btn.title = title
              btn.innerHTML = glyph
              L.DomEvent.on(btn, 'click', L.DomEvent.stop).on(btn, 'click', () => {
                if (mode === 'route' && !workspaceCanEditRef.current) return
                setMeasureMode(prev => (prev === mode ? null : mode))
                setMeasurePoints([])
                setShowRoutePicker(false)
                setEditingRoute(null)
                setPendingCenter(null)
                setSelectedPin(null)
                setNewPinCoords(null)
              })
              return btn
            },
          })

        new (makeModeToggleControl('measure', 'Mål afstand', '📏'))({ position: 'topright' }).addTo(map)
        new (makeModeToggleControl('route', 'Tegn og gem rute', '📍'))({ position: 'topright' }).addTo(map)

        map.on('click', (e: Leaflet.LeafletMouseEvent) => {
          if (!measureModeRef.current) return
          if (measureModeRef.current === 'route' && !workspaceCanEditRef.current) return
          if (lastPointerTypeRef.current === 'touch') {
            // Svært at ramme præcist med en finger - centrér kortet og lad brugeren finjustere før bekræftelse.
            map.panTo(e.latlng, { animate: true, duration: 0.4 })
            setPendingCenter({ purpose: 'route-point' })
          } else {
            setMeasurePoints(prev => [...prev, { lat: e.latlng.lat, lng: e.latlng.lng }])
          }
        })
      }

      // Lytter direkte på browserens native dblclick i stedet for Leaflets eget
      // semantiske 'dblclick'-event, som i kombination med doubleClickZoom:false
      // kan ende i en hængende klik/drag-tilstand på nogle browsere.
      if (!readOnly) {
        const containerEl = map.getContainer()

        const handlePointerDown = (e: PointerEvent) => {
          lastPointerTypeRef.current = e.pointerType
        }
        containerEl.addEventListener('pointerdown', handlePointerDown)

        const handleNativeDblClick = (domEvent: MouseEvent) => {
          if ((domEvent.target as Element | null)?.closest?.('.ue-grid-cell')) {
            domEvent.preventDefault()
            return
          }
          domEvent.preventDefault()
          if (!workspaceCanEditRef.current) return
          const latlng = map.mouseEventToLatLng(domEvent)
          setSelectedPin(null)
          setMeasureMode(null)
          setMeasurePoints([])
          setShowRoutePicker(false)
          setEditingRoute(null)

          if (lastPointerTypeRef.current === 'touch') {
            // På telefon er det svært at ramme det præcise sted med en finger,
            // så kortet centreres om tappet punkt og brugeren kan finjustere før bekræftelse.
            setNewPinCoords(null)
            map.panTo(latlng, { animate: true, duration: 0.4 })
            setPendingCenter({ purpose: 'new-pin' })
          } else {
            // På pc/mus er det let at ramme præcist - sæt pin direkte som hidtil.
            setPendingCenter(null)
            setNewPinCoords({ lat: latlng.lat, lng: latlng.lng })
          }
        }
        containerEl.addEventListener('dblclick', handleNativeDblClick)
        nativeDblClickCleanupRef.current = () => {
          containerEl.removeEventListener('pointerdown', handlePointerDown)
          containerEl.removeEventListener('dblclick', handleNativeDblClick)
        }
      }

      mapRef.current = map
      setMapReady(true)
    })

    return () => {
      cancelled = true
      if (mapRef.current) {
        const c = mapRef.current.getCenter()
        lastMapView = { center: [c.lat, c.lng], zoom: mapRef.current.getZoom() }
      }
      nativeDblClickCleanupRef.current?.()
      nativeDblClickCleanupRef.current = null
      baseLayerRef.current?.remove()
      baseLayerRef.current = null
      searchMarkerRef.current?.remove()
      searchMarkerRef.current = null
      locateMarkerRef.current?.remove()
      locateMarkerRef.current = null
      cadastralLayerRef.current?.remove()
      cadastralLayerRef.current = null
      cadastralHighlightLayerRef.current?.remove()
      cadastralHighlightLayerRef.current = null
      mapRef.current?.remove()
      mapRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [maptilerKey])

  useEffect(() => {
    measureModeRef.current = measureMode
  }, [measureMode])

  useEffect(() => {
    const map = mapRef.current
    const L = leafletRef.current
    if (!map || !L || !mapReady) return

    baseLayerRef.current?.remove()
    baseLayerRef.current = L.tileLayer(mapLayerTileUrl(mapLayerId, maptilerKey), {
      attribution: MAP_ATTRIBUTION,
      tileSize: 256,
      maxNativeZoom: MAP_MAX_NATIVE_ZOOM,
      maxZoom: MAP_MAX_ZOOM,
      crossOrigin: true,
    }).addTo(map)
  }, [mapLayerId, mapReady, maptilerKey])

  useEffect(() => {
    const map = mapRef.current
    const L = leafletRef.current
    if (!map || !L || !mapReady) return

    measureLayerRef.current?.remove()
    measureLayerRef.current = null
    if (measurePoints.length === 0) return

    const layer = L.layerGroup().addTo(map)
    const pointIcon = L.divIcon({
      className: '',
      html: `<div style="width:16px;height:16px;border-radius:50%;background:#e08a3c;border:2px solid #f2a65a;box-shadow:0 1px 3px rgba(0,0,0,0.6)"></div>`,
      iconSize: [16, 16],
      iconAnchor: [8, 8],
    })
    measurePoints.forEach((p, i) => {
      const marker = L.marker([p.lat, p.lng], { icon: pointIcon, draggable: true }).addTo(layer)
      marker.on('dragend', ev => {
        const ll = (ev.target as Leaflet.Marker).getLatLng()
        setMeasurePoints(prev => prev.map((pt, idx) => (idx === i ? { lat: ll.lat, lng: ll.lng } : pt)))
      })
      marker.on('click', () => {
        setMeasurePoints(prev => prev.filter((_, idx) => idx !== i))
      })
    })
    if (measurePoints.length >= 2) {
      L.polyline(measurePoints.map(p => [p.lat, p.lng]), { color: '#f2a65a', weight: 3, dashArray: '6 6' }).addTo(layer)

      for (let i = 0; i < measurePoints.length - 1; i++) {
        const a = measurePoints[i]
        const b = measurePoints[i + 1]
        const distance = L.latLng(a.lat, a.lng).distanceTo(b)
        const midLat = (a.lat + b.lat) / 2
        const midLng = (a.lng + b.lng) / 2
        L.marker([midLat, midLng], { icon: L.divIcon({ className: '', iconSize: [0, 0] }), interactive: false })
          .bindTooltip(formatDistance(distance), { permanent: true, direction: 'center', className: 'ue-measure-label', opacity: 1 })
          .addTo(layer)
      }
    }
    measureLayerRef.current = layer
  }, [measurePoints, mapReady])

  const measureTotalDistance = measurePoints.length >= 2 && leafletRef.current
    ? measurePoints.slice(1).reduce((sum, p, i) => sum + leafletRef.current!.latLng(measurePoints[i].lat, measurePoints[i].lng).distanceTo(p), 0)
    : null

  const viewingRoute = viewingRouteId
    ? pins.flatMap(p => p.routes).find(r => r.id === viewingRouteId)?.points ?? null
    : null

  useEffect(() => {
    const map = mapRef.current
    const L = leafletRef.current
    if (!map || !L || !mapReady) return

    viewRouteLayerRef.current?.remove()
    viewRouteLayerRef.current = null
    if (!viewingRoute || viewingRoute.length < 2) return

    const layer = L.layerGroup().addTo(map)
    const latlngs = viewingRoute.map(p => [p.lat, p.lng] as [number, number])
    L.polyline(latlngs, { color: '#38bdf8', weight: 4 }).addTo(layer)
    L.circleMarker(latlngs[0], { radius: 6, color: '#0ea5e9', weight: 2, fillColor: '#38bdf8', fillOpacity: 0.9 }).addTo(layer)
    L.circleMarker(latlngs[latlngs.length - 1], { radius: 6, color: '#0ea5e9', weight: 2, fillColor: '#38bdf8', fillOpacity: 0.9 }).addTo(layer)
    viewRouteLayerRef.current = layer
    map.fitBounds(L.latLngBounds(latlngs), { padding: [60, 60], maxZoom: 18 })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewingRouteId, mapReady])

  useEffect(() => {
    const map = mapRef.current
    const L = leafletRef.current
    if (!map || !L || !mapReady) return

    function redrawGrid() {
      gridLayerRef.current?.remove()
      gridLayerRef.current = null
      if (!gridEnabled || map!.getZoom() < GRID_MIN_ZOOM) return

      const bounds = map!.getBounds()
      const corner1 = gridCellForLatLng(bounds.getNorth(), bounds.getWest())
      const corner2 = gridCellForLatLng(bounds.getSouth(), bounds.getEast())
      const minRow = Math.min(corner1.row, corner2.row) - 1
      const maxRow = Math.max(corner1.row, corner2.row) + 1
      const minCol = Math.min(corner1.col, corner2.col) - 1
      const maxCol = Math.max(corner1.col, corner2.col) + 1
      if ((maxRow - minRow + 1) * (maxCol - minCol + 1) > GRID_MAX_CELLS) return

      const layer = L!.layerGroup().addTo(map!)
      for (let row = minRow; row <= maxRow; row++) {
        for (let col = minCol; col <= maxCol; col++) {
          const searched = searchedCells.has(gridCellKey(row, col))
          const { south, north, west, east } = gridCellBounds(row, col)
          const rect = L!.rectangle(
            [[south, west], [north, east]],
            {
              color: searched ? '#4ade80' : 'rgba(255,255,255,0.3)',
              weight: searched ? 1.5 : 1,
              fillColor: '#22c55e',
              fillOpacity: searched ? 0.35 : 0,
              interactive: !readOnly && workspaceCanEdit,
              className: readOnly || !workspaceCanEdit ? '' : 'ue-grid-cell',
            }
          )
          if (!readOnly && workspaceCanEdit) {
            rect.on('click', (event: Leaflet.LeafletMouseEvent) => {
              const originalEvent = event.originalEvent
              originalEvent.preventDefault()
              L!.DomEvent.stop(originalEvent)
              const key = gridCellKey(row, col)
              if (!shouldToggleGridCellFromClick(key)) return
              void toggleGridCell(row, col)
            })
          }
          rect.addTo(layer)
        }
      }
      gridLayerRef.current = layer
    }

    redrawGrid()
    map.on('moveend', redrawGrid)
    map.on('zoomend', redrawGrid)
    return () => {
      map.off('moveend', redrawGrid)
      map.off('zoomend', redrawGrid)
      gridLayerRef.current?.remove()
      gridLayerRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gridEnabled, searchedCells, mapReady, readOnly, workspaceCanEdit, activeWorkspaceOwnerId])

  useEffect(() => {
    const map = mapRef.current
    const L = leafletRef.current
    if (!map || !L || !mapReady) return

    cadastralLayerRef.current?.remove()
    cadastralLayerRef.current = null
    if (!cadastralEnabled) return

    cadastralLayerRef.current = L.tileLayer.wms(CADASTRAL_WMS_URL, {
      layers: CADASTRAL_LAYER,
      styles: '',
      format: 'image/png',
      transparent: true,
      version: '1.1.1',
      attribution: CADASTRAL_ATTRIBUTION,
      opacity: 0.95,
      minZoom: CADASTRAL_MIN_ZOOM,
      maxZoom: MAP_MAX_ZOOM,
      zIndex: 450,
      className: 'ue-cadastre-layer',
    }).addTo(map)

    return () => {
      cadastralLayerRef.current?.remove()
      cadastralLayerRef.current = null
    }
  }, [cadastralEnabled, mapReady])

  useEffect(() => {
    const map = mapRef.current
    const L = leafletRef.current
    if (!map || !L || !mapReady) return

    function redrawCadastralHighlight() {
      cadastralHighlightLayerRef.current?.remove()
      cadastralHighlightLayerRef.current = null
      if (!cadastralEnabled || !selectedCadastralFeatureId || map!.getZoom() < CADASTRAL_MIN_ZOOM) return

      const crs = map!.options.crs
      if (!crs) return

      const bounds = map!.getBounds()
      const southWest = crs.project(bounds.getSouthWest())
      const northEast = crs.project(bounds.getNorthEast())
      const size = map!.getSize()
      const filter = `<Filter><PropertyIsEqualTo><PropertyName>ogc_fid</PropertyName><Literal>${selectedCadastralFeatureId}</Literal></PropertyIsEqualTo></Filter>`
      const url = new URL(CADASTRAL_WMS_URL)
      url.search = new URLSearchParams({
        SERVICE: 'WMS',
        VERSION: '1.1.1',
        REQUEST: 'GetMap',
        FORMAT: 'image/png',
        TRANSPARENT: 'TRUE',
        LAYERS: CADASTRAL_LAYER,
        STYLES: '',
        WIDTH: String(Math.round(size.x)),
        HEIGHT: String(Math.round(size.y)),
        SRS: 'EPSG:3857',
        BBOX: [southWest.x, southWest.y, northEast.x, northEast.y].join(','),
        FILTER: filter,
      }).toString()

      cadastralHighlightLayerRef.current = L!.imageOverlay(url.toString(), bounds, {
        opacity: 1,
        interactive: false,
        className: 'ue-cadastre-highlight-layer',
      }).addTo(map!)
      cadastralHighlightLayerRef.current.setZIndex(470)
    }

    redrawCadastralHighlight()
    map.on('moveend', redrawCadastralHighlight)
    map.on('zoomend', redrawCadastralHighlight)
    map.on('resize', redrawCadastralHighlight)

    return () => {
      map.off('moveend', redrawCadastralHighlight)
      map.off('zoomend', redrawCadastralHighlight)
      map.off('resize', redrawCadastralHighlight)
      cadastralHighlightLayerRef.current?.remove()
      cadastralHighlightLayerRef.current = null
    }
  }, [cadastralEnabled, selectedCadastralFeatureId, mapReady])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapReady || !cadastralEnabled) return

    const handleCadastralClick = (event: Leaflet.LeafletMouseEvent) => {
      if (pendingCenter || newPinCoords || selectedPin) return
      void loadCadastralParcelInfo(event)
    }

    map.on('click', handleCadastralClick)
    return () => {
      map.off('click', handleCadastralClick)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cadastralEnabled, mapReady, pendingCenter, newPinCoords, selectedPin])

  useEffect(() => {
    const map = mapRef.current
    const L = leafletRef.current
    if (!map || !L || !mapReady) return

    const currentIds = new Set(visiblePins.map(p => p.id))

    for (const [id, marker] of markersRef.current) {
      if (!currentIds.has(id)) {
        marker.remove()
        markersRef.current.delete(id)
      }
    }

    function buildIcon(pin: Pin) {
      const glyph = pin.icon || '📍'
      return L!.divIcon({
        html: `
          <div style="display:flex;flex-direction:column;align-items:center;">
            <div style="box-sizing:border-box;width:38px;height:38px;border-radius:50%;background:white;display:flex;align-items:center;justify-content:center;font-size:19px;border:3px solid black;box-shadow:0 2px 4px rgba(0,0,0,0.5)">${glyph}</div>
            <div style="width:0;height:0;border-left:6px solid transparent;border-right:6px solid transparent;border-top:9px solid black;margin-top:-2px"></div>
          </div>
        `,
        className: '',
        iconSize: [38, 45],
        iconAnchor: [19, 45],
      })
    }

    function handleMarkerClick(pin: Pin) {
      setPendingCenter(null)
      setNewPinCoords(null)
      setMeasureMode(null)
      setMeasurePoints([])
      setShowRoutePicker(false)
      setEditingRoute(null)
      setSelectedPin(pin)
    }

    for (const pin of visiblePins) {
      const existing = markersRef.current.get(pin.id)
      if (existing) {
        existing.setLatLng([pin.latitude, pin.longitude])
        existing.setIcon(buildIcon(pin))
        // Genbinder click-handleren med det friske pin-objekt, ellers forbliver
        // fx en nygemt rute usynlig indtil en hård refresh genindlæser markørerne.
        existing.off('click')
        existing.on('click', () => handleMarkerClick(pin))
        continue
      }
      const marker = L.marker([pin.latitude, pin.longitude], { icon: buildIcon(pin) }).addTo(map)
      marker.on('click', () => handleMarkerClick(pin))
      markersRef.current.set(pin.id, marker)
    }
  }, [visiblePins, mapReady])

  // Deles mellem desktop-panelet og mobil-sheetet. Chips og knapper er større
  // under md-breakpointet, så de er til at ramme med en finger.
  const filterSections = (
    <>
      {!readOnly && (
        <div className="grid grid-cols-1 gap-1.5">
          <button
            onClick={() => { setUserShareOpen(true); setMobileFiltersOpen(false) }}
            className="btn-secondary text-sm md:text-xs py-3 md:py-2 flex items-center justify-center gap-1.5"
          >
            👥 Del med bruger
          </button>
          <button
            onClick={() => { setSharePickerOpen(true); setMobileFiltersOpen(false) }}
            className="btn-secondary text-sm md:text-xs py-3 md:py-2 flex items-center justify-center gap-1.5"
          >
            🔗 Del via link
          </button>
        </div>
      )}
      {!readOnly && sharedWorkspaces.length > 0 && (
        <div>
          <p className="text-sm md:text-xs text-gray-400 mb-1.5">Visning</p>
          <div className="flex flex-col gap-1.5">
            <button
              onClick={() => selectWorkspace(null)}
              className={`text-sm md:text-xs font-semibold px-4 py-3 md:px-3 md:py-2 rounded-xl md:rounded-lg border text-left transition-colors ${
                !activeWorkspaceOwnerId
                  ? 'border-rust-500 bg-rust-700/40 text-white'
                  : 'border-void-600 text-gray-400 hover:text-gray-200'
              }`}
            >
              Vis mine
            </button>
            <p className="text-xs md:text-[11px] text-gray-500 mt-1">Delt med dig</p>
            {sharedWorkspaces.map(workspace => (
              <button
                key={workspace.ownerId}
                onClick={() => selectWorkspace(workspace.ownerId)}
                className={`text-sm md:text-xs font-semibold px-4 py-3 md:px-3 md:py-2 rounded-xl md:rounded-lg border text-left transition-colors ${
                  activeWorkspaceOwnerId === workspace.ownerId
                    ? 'border-rust-500 bg-rust-700/40 text-white'
                    : 'border-void-600 text-gray-400 hover:text-gray-200'
                }`}
              >
                {workspace.ownerName}
                <span className="block text-[11px] md:text-[10px] font-normal text-gray-500 mt-0.5">
                  {workspace.canEdit ? 'Kan redigere' : 'Kan se'}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
      {(workspaceCategories.length > 0 || workspaceAllowsUncategorized) && (
        <div>
          <p className="text-sm md:text-xs text-gray-400 mb-1.5">Kategorier</p>
          <div className="flex flex-wrap gap-2 md:flex-col md:gap-1.5 md:items-start">
            {workspaceCategories.map(cat => (
              <button
                key={cat.id}
                onClick={() => toggleCategory(cat.id)}
                className={`text-sm md:text-xs font-medium px-4 py-2.5 md:px-2.5 md:py-1 rounded-full border transition-colors ${
                  activeCategoryIds.has(cat.id) ? 'text-white' : 'text-gray-400 border-void-600 opacity-50'
                }`}
                style={activeCategoryIds.has(cat.id) ? { backgroundColor: cat.color, borderColor: cat.color } : undefined}
              >
                {cat.name}
              </button>
            ))}
            {workspaceAllowsUncategorized && (
              <button
                onClick={() => toggleCategory(activeWorkspaceOwnerId ? sharedUncatKey(activeWorkspaceOwnerId) : NO_CATEGORY)}
                className={`text-sm md:text-xs font-medium px-4 py-2.5 md:px-2.5 md:py-1 rounded-full border transition-colors ${
                  activeCategoryIds.has(activeWorkspaceOwnerId ? sharedUncatKey(activeWorkspaceOwnerId) : NO_CATEGORY)
                    ? 'bg-void-700 text-gray-200 border-void-600'
                    : 'text-gray-500 border-void-600 opacity-50'
                }`}
              >
                Ingen kategori
              </button>
            )}
          </div>
        </div>
      )}
      <div>
        <p className="text-sm md:text-xs text-gray-400 mb-1.5">Mærke</p>
        <div className="flex flex-wrap gap-2 md:flex-col md:gap-1.5 md:items-start">
          {PIN_STATUSES.map(s => (
            <button
              key={s}
              onClick={() => toggleStatus(s)}
              className={`text-sm md:text-xs font-medium px-4 py-2.5 md:px-2.5 md:py-1 rounded-full border transition-colors ${
                activeStatuses.has(s) ? 'text-white' : 'text-gray-400 border-void-600 opacity-50'
              }`}
              style={activeStatuses.has(s) ? { backgroundColor: PIN_STATUS_COLORS[s], borderColor: PIN_STATUS_COLORS[s] } : undefined}
            >
              {PIN_STATUS_LABELS[s]}
            </button>
          ))}
        </div>
      </div>
      <div>
        <p className="text-sm md:text-xs text-gray-400 mb-1.5">Rating</p>
        <div className="flex flex-wrap gap-2 md:flex-col md:gap-1.5 md:items-start">
          <button
            onClick={() => toggleRating(0)}
            className={`text-sm md:text-xs font-medium px-4 py-2.5 md:px-2.5 md:py-1 rounded-full border transition-colors ${
              activeRatings.has(0) ? 'bg-void-700 text-gray-200 border-void-600' : 'text-gray-500 border-void-600 opacity-50'
            }`}
          >
            Ingen rating
          </button>
          {[1, 2, 3].map(r => (
            <button
              key={r}
              onClick={() => toggleRating(r)}
              className={`text-sm md:text-xs font-medium px-4 py-2.5 md:px-2.5 md:py-1 rounded-full border transition-colors ${
                activeRatings.has(r) ? 'bg-rust-600 text-white border-rust-600' : 'text-gray-400 border-void-600 opacity-50'
              }`}
            >
              {'★'.repeat(r)}
            </button>
          ))}
        </div>
      </div>
    </>
  )

  return (
    <div className="relative w-full h-[calc(100dvh-4rem)]">
      <div ref={containerRef} className="absolute inset-0 bg-void-900" />

      {!mapReady && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <p className="text-gray-500 text-sm">Indlæser kort...</p>
        </div>
      )}

      {pendingCenter && (
        <>
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-full z-[900] pointer-events-none">
            <div className="flex flex-col items-center">
              <div className="w-[38px] h-[38px] rounded-full bg-white border-[3px] border-black shadow-[0_2px_4px_rgba(0,0,0,0.5)] flex items-center justify-center text-lg">
                {pendingCenter.purpose === 'new-pin' ? '📍' : '📌'}
              </div>
              <div className="w-0 h-0 border-l-[6px] border-l-transparent border-r-[6px] border-r-transparent border-t-[9px] border-t-black -mt-0.5" />
            </div>
          </div>

          <div className="absolute top-20 md:top-16 left-1/2 -translate-x-1/2 z-[999] w-[200px] px-3 py-1.5 rounded-xl bg-void-900/90 border border-void-600 text-xs text-gray-200 shadow-lg backdrop-blur-sm text-center leading-snug">
            Flyt og zoom kortet for at ramme det præcise sted
          </div>

          <div className="absolute bottom-28 md:bottom-6 left-1/2 -translate-x-1/2 z-[1000] flex items-center gap-2">
            <button
              type="button"
              onClick={cancelPendingCenter}
              className="rounded-full bg-void-900/90 border border-void-600 text-gray-200 px-4 py-2.5 text-sm font-medium shadow-lg backdrop-blur-sm hover:bg-void-800 transition-colors"
            >
              Annuller
            </button>
            <button
              type="button"
              onClick={confirmPendingCenter}
              className="rounded-full bg-rust-600 text-white px-5 py-2.5 text-sm font-semibold shadow-lg hover:bg-rust-700 transition-colors flex items-center gap-1.5"
            >
              ✓ {pendingCenter.purpose === 'new-pin' ? 'Sæt pin' : 'Sæt punkt'}
            </button>
          </div>
        </>
      )}

      {measureMode && !pendingCenter && (
        <>
          <div className="absolute top-20 md:top-16 left-1/2 -translate-x-1/2 z-[999] w-[200px] px-3 py-1.5 rounded-xl bg-void-900/90 border border-void-600 text-xs text-gray-200 shadow-lg backdrop-blur-sm text-center leading-snug">
            {measureTotalDistance !== null
              ? <>{measureMode === 'route' ? '📍' : '📏'} I alt: {formatDistance(measureTotalDistance)}<br /><span className="text-gray-400">Klik for at forlænge linjen</span></>
              : measurePoints.length === 1
                ? 'Klik det andet punkt på kortet'
                : measureMode === 'route'
                  ? 'Tegn ruten ved at klikke punkter på kortet'
                  : 'Klik 2 steder på kortet for at måle afstanden'}
          </div>

          <div className="absolute bottom-28 md:bottom-6 left-1/2 -translate-x-1/2 z-[1000] flex items-center gap-2">
            {measurePoints.length > 0 && (
              <button
                type="button"
                onClick={clearMeasurement}
                className="rounded-full bg-void-900/90 border border-void-600 text-gray-200 px-4 py-2.5 text-sm font-medium shadow-lg backdrop-blur-sm hover:bg-void-800 transition-colors"
              >
                Ryd
              </button>
            )}
            {measureMode === 'measure' ? (
              <button
                type="button"
                onClick={() => toggleMeasureMode('measure')}
                className="rounded-full bg-rust-600 text-white px-5 py-2.5 text-sm font-semibold shadow-lg hover:bg-rust-700 transition-colors flex items-center gap-1.5"
              >
                ✕ Luk måling
              </button>
            ) : (
              <>
                <button
                  type="button"
                  onClick={() => toggleMeasureMode('route')}
                  className="rounded-full bg-void-900/90 border border-void-600 text-gray-200 px-4 py-2.5 text-sm font-medium shadow-lg backdrop-blur-sm hover:bg-void-800 transition-colors"
                >
                  Annuller
                </button>
                <button
                  type="button"
                  onClick={handleSaveRoute}
                  disabled={measurePoints.length < 2}
                  className="rounded-full bg-rust-600 text-white px-5 py-2.5 text-sm font-semibold shadow-lg hover:bg-rust-700 transition-colors flex items-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  💾 {editingRoute ? 'Opdater rute' : 'Gem rute'}
                </button>
              </>
            )}
          </div>
        </>
      )}

      {viewingRoute && (
        <div className="absolute bottom-28 md:bottom-6 left-1/2 -translate-x-1/2 z-[1000]">
          <button
            type="button"
            onClick={() => setViewingRouteId(null)}
            className="rounded-full bg-void-900/90 border border-void-600 text-gray-200 px-5 py-2.5 text-sm font-semibold shadow-lg backdrop-blur-sm hover:bg-void-800 transition-colors"
          >
            ✕ Skjul rute
          </button>
        </div>
      )}

      <form
        onSubmit={handleSearch}
        className="absolute top-3 left-3 right-3 z-[1000] md:left-1/2 md:right-auto md:w-[min(28rem,calc(100%-14rem))] md:-translate-x-1/2"
      >
        <div className="flex items-center gap-2 bg-void-900/90 backdrop-blur-sm border border-void-600 rounded-xl px-3 py-2 shadow-lg">
          <input
            value={searchQuery}
            onChange={event => {
              setSearchQuery(event.target.value)
              setSearchError(null)
            }}
            className="min-w-0 flex-1 bg-transparent text-sm text-gray-100 placeholder:text-gray-500 focus:outline-none"
            placeholder="Søg adresse eller koordinater"
            autoComplete="off"
          />
          <button
            type="submit"
            disabled={searching || !searchQuery.trim()}
            className="shrink-0 rounded-lg bg-rust-600 px-4 py-2.5 text-sm md:px-3 md:py-1.5 md:text-xs font-semibold text-white hover:bg-rust-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {searching ? '...' : 'Søg'}
          </button>
        </div>
        {searchError && (
          <p className="mt-1 rounded-lg border border-red-800/60 bg-red-950/95 px-3 py-1.5 text-xs text-red-200 shadow-lg">
            {searchError}
          </p>
        )}
      </form>

      <div className="hidden md:flex absolute top-52 right-3 z-[1000] flex-col items-end gap-2">
        <button
          type="button"
          onClick={togglePinsVisible}
          className="rounded-xl border border-void-600 bg-void-900/90 px-3 py-2 text-xs font-semibold text-gray-100 shadow-lg backdrop-blur-sm transition-colors hover:bg-void-800"
          aria-pressed={pinsVisible}
        >
          {pinsVisible ? 'Skjul pins' : 'Vis pins'}
        </button>

        <button
          type="button"
          onClick={toggleCadastralEnabled}
          className={`rounded-xl border px-3 py-2 text-xs font-semibold shadow-lg backdrop-blur-sm transition-colors ${
            cadastralEnabled
              ? 'border-sky-500 bg-sky-600 text-white hover:bg-sky-700'
              : 'border-void-600 bg-void-900/90 text-gray-100 hover:bg-void-800'
          }`}
          aria-pressed={cadastralEnabled}
        >
          {cadastralEnabled ? 'Skjul matrikel' : 'Vis matrikel'}
        </button>

        {!readOnly && (
          <button
            type="button"
            onClick={toggleGridEnabled}
            className={`rounded-xl border px-3 py-2 text-xs font-semibold shadow-lg backdrop-blur-sm transition-colors ${
              gridEnabled
                ? 'border-rust-600 bg-rust-600 text-white hover:bg-rust-700'
                : 'border-void-600 bg-void-900/90 text-gray-100 hover:bg-void-800'
            }`}
            aria-pressed={gridEnabled}
          >
            {gridEnabled ? 'Skjul gitter' : 'Vis gitter'}
          </button>
        )}

        <div
          className={`group rounded-2xl border border-void-600 bg-void-900/90 p-2 shadow-lg backdrop-blur-sm transition-[width] duration-150 ${
            layerPickerOpen ? 'w-48' : 'w-[4.5rem] md:hover:w-48 md:focus-within:w-48'
          }`}
          aria-label="Vaelg kortlag"
          onMouseLeave={() => setLayerPickerOpen(false)}
        >
          {(() => {
            const previewUrl = previewTile ? mapLayerPreviewUrl(selectedMapLayer.id, maptilerKey, previewTile) : null
            return (
              <button
                type="button"
                onClick={() => setLayerPickerOpen(prev => !prev)}
                className={`w-full rounded-xl p-1 text-left text-xs font-semibold text-white transition-colors flex items-center gap-2.5 hover:bg-rust-700 ${
                  layerPickerOpen ? 'bg-rust-600' : 'bg-transparent md:group-hover:bg-rust-600 md:group-focus-within:bg-rust-600'
                }`}
                aria-expanded={layerPickerOpen}
                aria-label={`Vaelg kortlag: ${selectedMapLayer.label}`}
              >
                <span className="h-11 w-11 shrink-0 overflow-hidden rounded-xl ring-1 ring-white/25 bg-void-800">
                  {previewUrl && (
                    <span
                      className="block h-full w-full bg-cover bg-center"
                      style={{ backgroundImage: `url("${previewUrl}")` }}
                    />
                  )}
                </span>
                <span className={`${layerPickerOpen ? 'block' : 'hidden'} min-w-0 flex-1 truncate md:group-focus-within:block md:group-hover:block`}>
                  {selectedMapLayer.label}
                </span>
                <svg
                  className={`${layerPickerOpen ? 'block' : 'hidden'} md:group-focus-within:block md:group-hover:block h-3.5 w-3.5 shrink-0 text-white/70 transition-transform ${layerPickerOpen ? 'rotate-180' : ''}`}
                  fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5} aria-hidden="true"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                </svg>
              </button>
            )
          })()}

          <div className={`${layerPickerOpen ? 'block' : 'hidden'} md:group-focus-within:block md:group-hover:block`}>
            <div className="my-1.5 border-t border-void-700" />
            <p className="px-1 pb-1 text-[10px] font-semibold uppercase tracking-wide text-gray-500">Andre kortlag</p>
            <div className="space-y-1">
              {MAP_LAYERS.filter(layer => layer.id !== mapLayerId).map(layer => {
                const previewUrl = previewTile ? mapLayerPreviewUrl(layer.id, maptilerKey, previewTile) : null
                return (
                  <button
                    key={layer.id}
                    type="button"
                    onClick={() => chooseMapLayer(layer.id)}
                    className="w-full rounded-xl p-1 text-left text-xs font-semibold transition-colors flex items-center gap-2.5 text-gray-400 hover:bg-void-800 hover:text-gray-100"
                    aria-pressed={false}
                  >
                    <span className="h-11 w-11 shrink-0 overflow-hidden rounded-xl ring-1 ring-void-600 bg-void-800">
                      {previewUrl && (
                        <span
                          className="block h-full w-full bg-cover bg-center"
                          style={{ backgroundImage: `url("${previewUrl}")` }}
                        />
                      )}
                    </span>
                    <span className="min-w-0 truncate">{layer.label}</span>
                  </button>
                )
              })}
            </div>
          </div>
        </div>
      </div>

      {gridEnabled && gridZoom < GRID_MIN_ZOOM && (
        <div className="absolute top-20 md:top-16 left-1/2 -translate-x-1/2 z-[999] w-[210px] px-3 py-1.5 rounded-xl bg-void-900/90 border border-void-600 text-xs text-gray-200 shadow-lg backdrop-blur-sm text-center leading-snug">
          🔳 Zoom ind for at se gitteret
        </div>
      )}

      {cadastralEnabled && gridZoom < CADASTRAL_MIN_ZOOM && (
        <div className="absolute top-32 md:top-28 left-1/2 -translate-x-1/2 z-[999] w-[220px] px-3 py-1.5 rounded-xl bg-void-900/90 border border-void-600 text-xs text-gray-200 shadow-lg backdrop-blur-sm text-center leading-snug">
          Zoom ind for at se matrikelkortet
        </div>
      )}

      {cadastralEnabled && cadastralInfo && (
        <div className="absolute right-3 bottom-28 md:bottom-3 z-[1000] w-[min(21rem,calc(100%-1.5rem))] rounded-xl border border-void-600 bg-void-900/95 p-3 text-sm text-gray-200 shadow-lg backdrop-blur-sm">
          <div className="mb-2 flex items-center justify-between gap-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">Matrikel</p>
            <button
              type="button"
              onClick={() => {
                setCadastralInfo(null)
                setSelectedCadastralFeatureId(null)
                setCadastralCopyState(null)
              }}
              className="rounded-lg px-3 py-2 text-sm md:rounded-md md:px-2 md:py-1 md:text-xs font-semibold text-gray-400 hover:bg-void-800 hover:text-gray-100"
            >
              Luk
            </button>
          </div>

          {cadastralInfo.status === 'loading' && (
            <p className="text-gray-300">Henter matrikelinfo...</p>
          )}

          {cadastralInfo.status === 'empty' && (
            <p className="text-gray-300">Ingen matrikel fundet her.</p>
          )}

          {cadastralInfo.status === 'error' && (
            <p className="text-red-200">{cadastralInfo.message}</p>
          )}

          {cadastralInfo.status === 'found' && (
            <div className="space-y-1.5">
              {cadastralInfo.parcel.label && (
                <p><span className="text-gray-500">Nr.</span> {cadastralInfo.parcel.label}</p>
              )}
              {cadastralInfo.zoning?.label && (
                <p><span className="text-gray-500">Ejerlav</span> {cadastralInfo.zoning.label}</p>
              )}
              {cadastralInfo.parcel.nationalCadastralReference && (
                <p><span className="text-gray-500">Reference</span> {cadastralInfo.parcel.nationalCadastralReference}</p>
              )}
              {typeof cadastralInfo.parcel.areaValue === 'number' && (
                <p><span className="text-gray-500">Areal</span> {formatArea(cadastralInfo.parcel.areaValue)}</p>
              )}
              {cadastralInfo.zoning?.reference && (
                <p><span className="text-gray-500">Ejerlavskode</span> {cadastralInfo.zoning.reference}</p>
              )}
              {cadastralInfo.parcel.basicPropertyUnitId && (
                <div className="flex items-center justify-between gap-3">
                  <p><span className="text-gray-500">BFE</span> {cadastralInfo.parcel.basicPropertyUnitId}</p>
                  <button
                    type="button"
                    onClick={() => void copyCadastralBfe(cadastralInfo.parcel.basicPropertyUnitId!)}
                    className="rounded-lg border border-void-600 px-3 py-2 text-sm md:rounded-md md:px-2 md:py-1 md:text-xs font-semibold text-gray-300 hover:bg-void-800 hover:text-gray-100"
                  >
                    {cadastralCopyState?.status === 'copied' && cadastralCopyState.value === cadastralInfo.parcel.basicPropertyUnitId
                      ? 'Kopieret'
                      : 'Kopier'}
                  </button>
                </div>
              )}
              {cadastralInfo.parcel.basicPropertyUnitId && cadastralCopyState?.value === cadastralInfo.parcel.basicPropertyUnitId && (
                <p className={`text-xs ${cadastralCopyState.status === 'copied' ? 'text-emerald-300' : 'text-amber-300'}`}>
                  {cadastralCopyState.status === 'copied'
                    ? 'BFE kopieret til klipboard'
                    : 'Kunne ikke kopiere automatisk'}
                </p>
              )}
              {cadastralInfo.parcel.cadastralParcelId && (
                <p><span className="text-gray-500">Jordstykke-id</span> {cadastralInfo.parcel.cadastralParcelId}</p>
              )}
              {cadastralInfo.parcel.administrativeUnitCode && (
                <p><span className="text-gray-500">Kommune-kode</span> {cadastralInfo.parcel.administrativeUnitCode}</p>
              )}
              {cadastralInfo.zoning?.levelName && (
                <p><span className="text-gray-500">Niveau</span> {cadastralInfo.zoning.levelName}</p>
              )}
              {cadastralInfo.parcel.validFrom && (
                <p><span className="text-gray-500">Gyldig fra</span> {formatDateTime(cadastralInfo.parcel.validFrom)}</p>
              )}
            </div>
          )}
        </div>
      )}

      {/* Desktop: fast filterpanel. På mobil bor filtrene i bottom sheet'et længere nede. */}
      <div className="hidden md:block absolute top-3 left-3 z-[1000] max-w-[calc(100%-5.5rem)]">
        <div className="bg-void-900/80 backdrop-blur-sm border border-void-600 rounded-xl shadow-lg p-3 space-y-3 max-h-[calc(100dvh-6rem)] overflow-y-auto">
          {filterSections}
        </div>
      </div>

      {/* Mobil: værktøjsdok over bundnavigationen. Skjules når et kort-overlay
          (måling, pin-placering, rutevisning, matrikelinfo) selv viser knapper i bunden. */}
      {mapReady && !measureMode && !pendingCenter && !viewingRoute && !cadastralInfo && (
        <div className="md:hidden fixed bottom-[calc(env(safe-area-inset-bottom)+6.25rem)] left-1/2 -translate-x-1/2 z-[1200]">
          <div className="flex items-center gap-1 rounded-full border border-void-600 bg-void-900/90 p-1.5 shadow-xl shadow-black/60 backdrop-blur-md">
            <button
              type="button"
              onClick={locateUser}
              aria-label="Find min position"
              className="flex h-12 w-12 items-center justify-center rounded-full text-xl transition-colors active:bg-void-700"
            >
              🎯
            </button>
            {!readOnly && (
              <>
                <button
                  type="button"
                  onClick={() => toggleMeasureMode('measure')}
                  aria-label="Mål afstand"
                  className="flex h-12 w-12 items-center justify-center rounded-full text-xl transition-colors active:bg-void-700"
                >
                  📏
                </button>
                {workspaceCanEdit && (
                  <button
                    type="button"
                    onClick={() => toggleMeasureMode('route')}
                    aria-label="Tegn og gem rute"
                    className="flex h-12 w-12 items-center justify-center rounded-full text-xl transition-colors active:bg-void-700"
                  >
                    📍
                  </button>
                )}
              </>
            )}
            <button
              type="button"
              onClick={() => setMobileLayersOpen(true)}
              aria-label="Kortlag og lag på kortet"
              className="flex h-12 w-12 items-center justify-center rounded-full text-xl transition-colors active:bg-void-700"
            >
              🗺️
            </button>
            <button
              type="button"
              onClick={() => setMobileFiltersOpen(true)}
              aria-label="Filtre"
              className="flex h-12 w-12 items-center justify-center rounded-full text-gray-100 transition-colors active:bg-void-700"
            >
              <svg className="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 5h18l-7 8v5l-4 2v-7L3 5z" />
              </svg>
            </button>
          </div>
        </div>
      )}

      {/* Mobil: filtre som bottom sheet */}
      {mobileFiltersOpen && (
        <div
          className="md:hidden ue-modal-backdrop fixed inset-0 z-[2000] flex items-end bg-black/60"
          onClick={() => setMobileFiltersOpen(false)}
        >
          <div
            className="ue-modal-panel w-full bg-void-900 rounded-t-2xl border-t border-void-700 max-h-[80dvh] overflow-y-auto pb-[calc(env(safe-area-inset-bottom)+1.25rem)]"
            onClick={e => e.stopPropagation()}
          >
            <div className="mx-auto mt-2.5 h-1 w-10 rounded-full bg-void-600" />
            <div className="sticky top-0 z-10 flex items-center justify-between bg-void-900 px-5 py-3">
              <h2 className="font-semibold text-gray-100">Filtre</h2>
              <button
                type="button"
                onClick={() => setMobileFiltersOpen(false)}
                className="rounded-lg px-4 py-2 text-sm font-semibold text-gray-300 active:bg-void-800"
              >
                Luk
              </button>
            </div>
            <div className="space-y-4 px-5 pt-1">
              {filterSections}
            </div>
          </div>
        </div>
      )}

      {/* Mobil: kortlag + lag-toggles som bottom sheet */}
      {mobileLayersOpen && (
        <div
          className="md:hidden ue-modal-backdrop fixed inset-0 z-[2000] flex items-end bg-black/60"
          onClick={() => setMobileLayersOpen(false)}
        >
          <div
            className="ue-modal-panel w-full bg-void-900 rounded-t-2xl border-t border-void-700 max-h-[80dvh] overflow-y-auto pb-[calc(env(safe-area-inset-bottom)+1.25rem)]"
            onClick={e => e.stopPropagation()}
          >
            <div className="mx-auto mt-2.5 h-1 w-10 rounded-full bg-void-600" />
            <div className="sticky top-0 z-10 flex items-center justify-between bg-void-900 px-5 py-3">
              <h2 className="font-semibold text-gray-100">Kortlag</h2>
              <button
                type="button"
                onClick={() => setMobileLayersOpen(false)}
                className="rounded-lg px-4 py-2 text-sm font-semibold text-gray-300 active:bg-void-800"
              >
                Luk
              </button>
            </div>
            <div className="space-y-1.5 px-5">
              {MAP_LAYERS.map(layer => {
                const active = layer.id === mapLayerId
                const layerPreviewUrl = previewTile ? mapLayerPreviewUrl(layer.id, maptilerKey, previewTile) : null
                return (
                  <button
                    key={layer.id}
                    type="button"
                    onClick={() => chooseMapLayer(layer.id)}
                    aria-pressed={active}
                    className={`flex w-full items-center gap-3 rounded-xl border p-2 text-left transition-colors ${
                      active ? 'border-rust-500 bg-rust-600/15' : 'border-void-700 active:bg-void-800'
                    }`}
                  >
                    <span className="h-12 w-12 shrink-0 overflow-hidden rounded-lg bg-void-800 ring-1 ring-void-600">
                      {layerPreviewUrl && (
                        <span
                          className="block h-full w-full bg-cover bg-center"
                          style={{ backgroundImage: `url("${layerPreviewUrl}")` }}
                        />
                      )}
                    </span>
                    <span className={`min-w-0 flex-1 truncate text-sm font-semibold ${active ? 'text-white' : 'text-gray-300'}`}>
                      {layer.label}
                    </span>
                    {active && (
                      <svg className="h-5 w-5 shrink-0 text-rust-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} aria-hidden="true">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                      </svg>
                    )}
                  </button>
                )
              })}
            </div>
            <p className="px-5 pb-1 pt-4 text-xs font-semibold uppercase tracking-wide text-gray-500">Lag på kortet</p>
            <div className="px-5">
              {[
                { key: 'pins', label: 'Pins', on: pinsVisible, onToggle: togglePinsVisible, show: true },
                { key: 'cadastre', label: 'Matrikelkort', on: cadastralEnabled, onToggle: toggleCadastralEnabled, show: true },
                { key: 'grid', label: 'Søge-gitter (1×1 km)', on: gridEnabled, onToggle: toggleGridEnabled, show: !readOnly },
              ].filter(t => t.show).map(t => (
                <button
                  key={t.key}
                  type="button"
                  onClick={t.onToggle}
                  aria-pressed={t.on}
                  className="flex w-full items-center justify-between gap-3 rounded-xl px-1 py-3 text-left"
                >
                  <span className="text-sm font-medium text-gray-200">{t.label}</span>
                  <span className={`relative h-7 w-12 shrink-0 rounded-full transition-colors ${t.on ? 'bg-rust-600' : 'bg-void-700'}`}>
                    <span
                      className={`absolute left-1 top-1 h-5 w-5 rounded-full bg-white shadow transition-transform ${t.on ? 'translate-x-5' : ''}`}
                    />
                  </span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {(newPinCoords || selectedPin) && (
        <PinModal
          coords={newPinCoords}
          pin={selectedPin}
          categories={workspaceCategories}
          createOwnerId={activeWorkspaceOwnerId ?? undefined}
          allowUncategorized={workspaceCanCreateUncategorized}
          onClose={() => {
            setNewPinCoords(null)
            setSelectedPin(null)
          }}
          onCreated={pin => {
            setPins(prev => [pin, ...prev])
            setNewPinCoords(null)
            setSelectedPin(null)
          }}
          onUpdated={updated => {
            setPins(prev => prev.map(p => (p.id === updated.id ? updated : p)))
            setSelectedPin(updated)
          }}
          onDeleted={id => {
            setPins(prev => prev.filter(p => p.id !== id))
            setSelectedPin(null)
          }}
          visibleRouteId={viewingRouteId}
          onToggleRoute={routeId => setViewingRouteId(prev => (prev === routeId ? null : routeId))}
          onEditRoute={(route: PinRoute) => {
            if (!selectedPin) return
            setMeasureMode('route')
            setMeasurePoints(route.points)
            setEditingRoute({ pinId: selectedPin.id, routeId: route.id })
            setSelectedPin(null)
            setNewPinCoords(null)
          }}
          readOnly={readOnly || (!selectedPin && !workspaceCanEdit) || selectedPin?.canEdit === false}
        />
      )}

      {sharePickerOpen && (
        <SharePickerModal
          pins={pins.filter(p => !p.ownerName)}
          categories={ownCategories}
          onClose={() => setSharePickerOpen(false)}
        />
      )}

      {userShareOpen && <UserShareModal onClose={() => setUserShareOpen(false)} />}

      {showRoutePicker && measurePoints.length >= 2 && (
        <SaveRouteModal
          pins={workspacePins.filter(p => p.canEdit !== false)}
          points={measurePoints}
          onClose={() => setShowRoutePicker(false)}
          onSaved={(pinId, route) => {
            setPins(prev => prev.map(p => (p.id === pinId ? { ...p, routes: [...p.routes, route] } : p)))
            setShowRoutePicker(false)
            setMeasureMode(null)
            setMeasurePoints([])
          }}
        />
      )}
    </div>
  )
}
