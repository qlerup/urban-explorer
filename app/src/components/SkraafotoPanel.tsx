'use client'

import { useEffect, useRef, useState } from 'react'
import type * as Leaflet from 'leaflet'

type Direction = 'north' | 'south' | 'east' | 'west'

interface SkraafotoPhoto {
  id: string
  direction: Direction
  year: number
  datetime: string
  thumbnailUrl: string
  cogUrl: string
}

interface CogInfo {
  width: number
  height: number
  tile_width: number
  tile_height: number
  overviews: number
}

interface Props {
  lat: number
  lng: number
  onClose: () => void
}

const DIRECTION_LABELS: Record<Direction, string> = {
  north: 'Nord',
  south: 'Syd',
  east: 'Øst',
  west: 'Vest',
}

const DIRECTION_ORDER: Direction[] = ['north', 'east', 'south', 'west']

export default function SkraafotoPanel({ lat, lng, onClose }: Props) {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [photos, setPhotos] = useState<SkraafotoPhoto[]>([])
  const [direction, setDirection] = useState<Direction | null>(null)
  const [year, setYear] = useState<number | null>(null)
  const [viewerLoading, setViewerLoading] = useState(false)
  const [viewerError, setViewerError] = useState<string | null>(null)

  const containerRef = useRef<HTMLDivElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<Leaflet.Map | null>(null)
  const leafletRef = useRef<typeof Leaflet | null>(null)
  const tileLayerRef = useRef<Leaflet.TileLayer | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    fetch(`/api/skraafoto/search?lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lng)}`)
      .then(async res => {
        const data = await res.json()
        if (!res.ok) throw new Error(data.error || 'Kunne ikke hente skråfotos')
        return data.photos as SkraafotoPhoto[]
      })
      .then(list => {
        if (cancelled) return
        setPhotos(list)
        if (list.length === 0) {
          setError('Der findes ingen skråfotos for dette punkt')
          return
        }
        const newest = list[0]
        setDirection(newest.direction)
        setYear(newest.year)
      })
      .catch(err => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Kunne ikke hente skråfotos')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => { cancelled = true }
  }, [lat, lng])

  const availableDirections = DIRECTION_ORDER.filter(d => photos.some(p => p.direction === d))
  const yearsForDirection = direction
    ? Array.from(new Set(photos.filter(p => p.direction === direction).map(p => p.year))).sort((a, b) => b - a)
    : []
  const activePhoto = photos.find(p => p.direction === direction && p.year === year) ?? null

  function handleDirectionChange(next: Direction) {
    setDirection(next)
    const years = Array.from(new Set(photos.filter(p => p.direction === next).map(p => p.year))).sort((a, b) => b - a)
    if (years.length > 0 && !years.includes(year ?? -1)) setYear(years[0])
  }

  useEffect(() => {
    let cancelled = false
    tileLayerRef.current?.remove()
    tileLayerRef.current = null
    mapRef.current?.remove()
    mapRef.current = null
    if (!activePhoto || !containerRef.current) return

    setViewerLoading(true)
    setViewerError(null)

    fetch(`/api/skraafoto/info?url=${encodeURIComponent(activePhoto.cogUrl)}`)
      .then(async res => {
        const text = await res.text()
        let data: { error?: string } & Partial<CogInfo>
        try {
          data = JSON.parse(text)
        } catch {
          // Midlertidig diagnostik: svaret var slet ikke JSON (fx en HTML-fejlside fra en proxy).
          throw new Error(`Uventet svar (status ${res.status}): ${text.slice(0, 300)}`)
        }
        if (!res.ok) throw new Error(data.error || 'Kunne ikke hente billedinfo')
        return data as CogInfo
      })
      .then(async info => {
        if (cancelled || !containerRef.current) return
        const leafletModule = await import('leaflet')
        const L = (leafletModule as unknown as { default?: typeof Leaflet }).default ?? (leafletModule as unknown as typeof Leaflet)
        if (cancelled || !containerRef.current) return
        leafletRef.current = L

        const maxZoom = Math.max(0, info.overviews)
        const map = L.map(containerRef.current, {
          crs: L.CRS.Simple,
          minZoom: 0,
          maxZoom,
          attributionControl: false,
        })
        const southWest = map.unproject([0, info.height], maxZoom)
        const northEast = map.unproject([info.width, 0], maxZoom)
        const bounds = L.latLngBounds(southWest, northEast)
        map.setMaxBounds(bounds)
        map.fitBounds(bounds)

        const tileUrl = `/api/skraafoto/tiles/{z}/{x}/{y}?url=${encodeURIComponent(activePhoto.cogUrl)}`
        tileLayerRef.current = L.tileLayer(tileUrl, {
          tileSize: info.tile_width,
          minZoom: 0,
          maxZoom,
          noWrap: true,
          bounds,
        }).addTo(map)

        mapRef.current = map
        setViewerLoading(false)
      })
      .catch(err => {
        if (!cancelled) {
          setViewerError(err instanceof Error ? err.message : 'Kunne ikke hente skråfoto')
          setViewerLoading(false)
        }
      })

    return () => {
      cancelled = true
      tileLayerRef.current?.remove()
      tileLayerRef.current = null
      mapRef.current?.remove()
      mapRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activePhoto?.id])

  function toggleFullscreen() {
    if (!panelRef.current) return
    if (document.fullscreenElement) {
      void document.exitFullscreen()
    } else {
      void panelRef.current.requestFullscreen()
    }
  }

  return (
    <div className="ue-modal-backdrop fixed inset-0 z-[2000] flex items-end md:items-center justify-center bg-black/60" onClick={onClose}>
      <div
        ref={panelRef}
        className="ue-modal-panel w-full md:max-w-3xl bg-void-900 md:rounded-2xl rounded-t-2xl border border-void-700 h-[85vh] flex flex-col overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-void-700 shrink-0">
          <h2 className="font-semibold text-gray-100">📷 Skråfoto</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-200 text-2xl leading-none px-1">×</button>
        </div>

        {loading ? (
          <div className="flex-1 flex items-center justify-center text-sm text-gray-400">Henter skråfotos...</div>
        ) : error ? (
          <div className="flex-1 flex items-center justify-center text-sm text-gray-400 px-5 text-center">{error}</div>
        ) : (
          <>
            <div className="flex items-center gap-3 px-5 py-3 border-b border-void-700 shrink-0">
              <select
                className="input flex-1"
                value={direction ?? ''}
                onChange={e => handleDirectionChange(e.target.value as Direction)}
              >
                {availableDirections.map(d => (
                  <option key={d} value={d}>{DIRECTION_LABELS[d]}</option>
                ))}
              </select>
              <select
                className="input flex-1"
                value={year ?? ''}
                onChange={e => setYear(Number(e.target.value))}
              >
                {yearsForDirection.map(y => (
                  <option key={y} value={y}>{y}</option>
                ))}
              </select>
              <button
                type="button"
                onClick={toggleFullscreen}
                className="btn-secondary shrink-0 px-3 py-2 text-sm"
                title="Fuld skærm"
              >
                ⛶
              </button>
            </div>

            <div className="relative flex-1 bg-void-950">
              <div ref={containerRef} className="absolute inset-0" />
              {viewerLoading && (
                <div className="absolute inset-0 flex items-center justify-center text-sm text-gray-400 pointer-events-none">
                  Indlæser billede...
                </div>
              )}
              {viewerError && (
                <div className="absolute inset-0 flex items-center justify-center text-sm text-gray-400 px-5 text-center pointer-events-none">
                  {viewerError}
                </div>
              )}
            </div>

            <p className="px-5 py-2 text-[11px] text-gray-500 border-t border-void-700 shrink-0">
              © Styrelsen for Dataforsyning og Infrastruktur — skråfoto {activePhoto ? new Date(activePhoto.datetime).toLocaleDateString('da-DK') : ''}
            </p>
          </>
        )}
      </div>
    </div>
  )
}
