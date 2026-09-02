import type { Category, Pin } from '@/types/pin'

export type OfflineMapQuality = 'basis' | 'standard' | 'high' | 'max'

export interface OfflineBounds {
  south: number
  west: number
  north: number
  east: number
}

export interface OfflineSavedRoute {
  id: string
  name: string
  routeData: {
    optimized: boolean
    orderedStopIds: string[]
    shapes: string[]
    legs: Array<{
      fromId: string | null
      toId: string | null
      distanceKm: number | null
      durationSeconds: number | null
    }>
    distanceKm: number | null
    durationSeconds: number | null
    selectedPinIds: string[]
    stopLabels: Record<string, string>
    stopCoordinates: Record<string, { lat: number; lng: number }>
  }
}

export interface OfflineMapArea {
  id: string
  name: string
  bounds: OfflineBounds
  downloadBounds: OfflineBounds
  quality: OfflineMapQuality
  minZoom: number
  maxZoom: number
  tileCount: number
  mapBytes: number
  pinBytes: number
  routeBytes: number
  totalBytes: number
  pins: Pin[]
  categories: Category[]
  routes: OfflineSavedRoute[]
  createdAt: string
  updatedAt: string
}

export const OFFLINE_DB_NAME = 'urban-explorer-offline'
export const OFFLINE_DB_VERSION = 1
export const OFFLINE_AREA_STORE = 'areas'
export const OFFLINE_ACTIVE_KEY = 'urban-explorer-active-offline-area'
export const OFFLINE_CACHE_PREFIX = 'urban-explorer-offline-map-'

export const OFFLINE_QUALITY: Record<OfflineMapQuality, { label: string; maxZoom: number; description: string }> = {
  basis: { label: 'Basis', maxZoom: 14, description: 'Overblik og kørsel' },
  standard: { label: 'Standard', maxZoom: 16, description: 'God detalje til normal brug' },
  high: { label: 'Høj', maxZoom: 18, description: 'Tæt luftfoto og bygninger' },
  max: { label: 'Maksimal', maxZoom: 20, description: 'Maksimal GeoDanmark-detalje' },
}

export const OFFLINE_MIN_ZOOM = 6
export const OFFLINE_BUFFER_KM = 3
export const OFFLINE_MAX_TILES = 100_000

function openOfflineDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(OFFLINE_DB_NAME, OFFLINE_DB_VERSION)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(OFFLINE_AREA_STORE)) {
        db.createObjectStore(OFFLINE_AREA_STORE, { keyPath: 'id' })
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('Offline-databasen kunne ikke åbnes'))
  })
}

export async function listOfflineAreas(): Promise<OfflineMapArea[]> {
  const db = await openOfflineDb()
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(OFFLINE_AREA_STORE, 'readonly')
      const request = tx.objectStore(OFFLINE_AREA_STORE).getAll()
      request.onsuccess = () => {
        const areas = (request.result as OfflineMapArea[])
          .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
        resolve(areas)
      }
      request.onerror = () => reject(request.error ?? new Error('Offlineområder kunne ikke hentes'))
    })
  } finally {
    db.close()
  }
}

export async function saveOfflineArea(area: OfflineMapArea): Promise<void> {
  const db = await openOfflineDb()
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(OFFLINE_AREA_STORE, 'readwrite')
      tx.objectStore(OFFLINE_AREA_STORE).put(area)
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error ?? new Error('Offlineområdet kunne ikke gemmes'))
      tx.onabort = () => reject(tx.error ?? new Error('Offlineområdet kunne ikke gemmes'))
    })
  } finally {
    db.close()
  }
}

export async function deleteOfflineArea(areaId: string): Promise<void> {
  const db = await openOfflineDb()
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(OFFLINE_AREA_STORE, 'readwrite')
      tx.objectStore(OFFLINE_AREA_STORE).delete(areaId)
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error ?? new Error('Offlineområdet kunne ikke slettes'))
      tx.onabort = () => reject(tx.error ?? new Error('Offlineområdet kunne ikke slettes'))
    })
  } finally {
    db.close()
  }
  await caches.delete(`${OFFLINE_CACHE_PREFIX}${areaId}`)
  if (getActiveOfflineAreaId() === areaId) setActiveOfflineAreaId(null)
}

export function getActiveOfflineAreaId(): string | null {
  if (typeof window === 'undefined') return null
  return window.localStorage.getItem(OFFLINE_ACTIVE_KEY)
}

export function setActiveOfflineAreaId(areaId: string | null): void {
  if (typeof window === 'undefined') return
  if (areaId) window.localStorage.setItem(OFFLINE_ACTIVE_KEY, areaId)
  else window.localStorage.removeItem(OFFLINE_ACTIVE_KEY)
}

export function areaCacheName(areaId: string): string {
  return `${OFFLINE_CACHE_PREFIX}${areaId}`
}

export function bufferBounds(bounds: OfflineBounds, bufferKm = OFFLINE_BUFFER_KM): OfflineBounds {
  const midLat = (bounds.south + bounds.north) / 2
  const latPad = bufferKm / 111.32
  const lngScale = Math.max(0.15, Math.cos((midLat * Math.PI) / 180))
  const lngPad = bufferKm / (111.32 * lngScale)
  return {
    south: Math.max(-85.05112878, bounds.south - latPad),
    west: Math.max(-180, bounds.west - lngPad),
    north: Math.min(85.05112878, bounds.north + latPad),
    east: Math.min(180, bounds.east + lngPad),
  }
}

function lngToTileX(lng: number, zoom: number): number {
  const n = 2 ** zoom
  return Math.floor(((lng + 180) / 360) * n)
}

function latToTileY(lat: number, zoom: number): number {
  const clamped = Math.max(-85.05112878, Math.min(85.05112878, lat))
  const latRad = (clamped * Math.PI) / 180
  const n = 2 ** zoom
  return Math.floor(((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n)
}

export interface OfflineTileCoordinate {
  z: number
  x: number
  y: number
}

export function tilesForBounds(bounds: OfflineBounds, minZoom: number, maxZoom: number): OfflineTileCoordinate[] {
  const result: OfflineTileCoordinate[] = []
  for (let z = minZoom; z <= maxZoom; z += 1) {
    const max = 2 ** z - 1
    const xMin = Math.max(0, Math.min(max, lngToTileX(bounds.west, z)))
    const xMax = Math.max(0, Math.min(max, lngToTileX(bounds.east, z)))
    const yMin = Math.max(0, Math.min(max, latToTileY(bounds.north, z)))
    const yMax = Math.max(0, Math.min(max, latToTileY(bounds.south, z)))
    for (let x = Math.min(xMin, xMax); x <= Math.max(xMin, xMax); x += 1) {
      for (let y = Math.min(yMin, yMax); y <= Math.max(yMin, yMax); y += 1) {
        result.push({ z, x, y })
      }
    }
  }
  return result
}

export function pointInBounds(lat: number, lng: number, bounds: OfflineBounds): boolean {
  return lat >= bounds.south && lat <= bounds.north && lng >= bounds.west && lng <= bounds.east
}

export function formatOfflineBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 KB'
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024)).toLocaleString('da-DK')} KB`
  const mb = bytes / 1024 / 1024
  if (mb < 1000) return `${mb.toLocaleString('da-DK', { maximumFractionDigits: mb < 10 ? 1 : 0 })} MB`
  return `${(mb / 1024).toLocaleString('da-DK', { minimumFractionDigits: 1, maximumFractionDigits: 2 })} GB`
}

export function jsonByteSize(value: unknown): number {
  return new Blob([JSON.stringify(value)]).size
}
