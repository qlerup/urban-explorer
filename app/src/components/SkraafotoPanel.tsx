'use client'

import { useEffect, useRef, useState } from 'react'
import type OlMap from 'ol/Map.js'
import { encodeUpstreamUrl } from '@/lib/skraafoto'
import { wgs84ToUtm32 } from '@/lib/geo'

type Direction = 'north' | 'south' | 'east' | 'west'

interface InteriorOrientation {
  focal_length?: number
  pixel_spacing?: number[]
  principal_point_offset?: number[]
  sensor_array_dimensions?: number[]
}

interface CameraMetadata {
  omega?: number
  phi?: number
  kappa?: number
  perspectiveCenter?: number[]
  crs?: number
  interiorOrientation?: InteriorOrientation
}

interface SkraafotoPhoto {
  id: string
  direction: Direction
  year: number
  datetime: string
  thumbnailUrl: string
  cogUrl: string
  camera?: CameraMetadata
}

interface Props {
  lat: number
  lng: number
  onClose: () => void
}

type UrbanExplorerWindow = Window & {
  __urbanExplorerMapZoom?: number
}

const DIRECTION_LABELS: Record<Direction, string> = {
  north: 'Nord',
  south: 'Syd',
  east: 'Øst',
  west: 'Vest',
}

const DIRECTION_ORDER: Direction[] = ['north', 'east', 'south', 'west']
const MAP_TO_SKRAAFOTO_ZOOM_DIFFERENCE = 15
const DEFAULT_SKRAAFOTO_ZOOM = 4

function radians(degrees: number): number {
  return degrees * (Math.PI / 180)
}

// Samme fotogrammetriske world -> image-beregning som Dataforsyningens officielle
// @dataforsyningen/saul getImageXY. Skråfotoets metadata er i EPSG:25832.
function getImageCoordinate(photo: SkraafotoPhoto, easting: number, northing: number, elevation = 0): [number, number] | null {
  const camera = photo.camera
  const interior = camera?.interiorOrientation
  const center = camera?.perspectiveCenter
  const focalLength = interior?.focal_length
  const pixelSpacing = interior?.pixel_spacing?.[0]
  const principalPoint = interior?.principal_point_offset
  const dimensions = interior?.sensor_array_dimensions
  const omega = camera?.omega
  const phi = camera?.phi
  const kappa = camera?.kappa

  if (
    camera?.crs !== 25832 ||
    !center || center.length < 3 ||
    !principalPoint || principalPoint.length < 2 ||
    !dimensions || dimensions.length < 2 ||
    !Number.isFinite(focalLength) ||
    !Number.isFinite(pixelSpacing) ||
    !pixelSpacing ||
    !Number.isFinite(omega) ||
    !Number.isFinite(phi) ||
    !Number.isFinite(kappa)
  ) {
    return null
  }

  const xx0 = principalPoint[0]
  const yy0 = principalPoint[1]
  const c = -focalLength!
  const dimX = dimensions[0] * pixelSpacing / 2 * -1
  const dimY = dimensions[1] * pixelSpacing / 2 * -1
  const [x0, y0, z0] = center

  const o = radians(omega!)
  const p = radians(phi!)
  const k = radians(kappa!)

  const d11 = Math.cos(p) * Math.cos(k)
  const d12 = -Math.cos(p) * Math.sin(k)
  const d13 = Math.sin(p)
  const d21 = Math.cos(o) * Math.sin(k) + Math.sin(o) * Math.sin(p) * Math.cos(k)
  const d22 = Math.cos(o) * Math.cos(k) - Math.sin(o) * Math.sin(p) * Math.sin(k)
  const d23 = -Math.sin(o) * Math.cos(p)
  const d31 = Math.sin(o) * Math.sin(k) - Math.cos(o) * Math.sin(p) * Math.cos(k)
  const d32 = Math.sin(o) * Math.cos(k) + Math.cos(o) * Math.sin(p) * Math.sin(k)
  const d33 = Math.cos(o) * Math.cos(p)

  const dx = easting - x0
  const dy = northing - y0
  const dz = elevation - z0
  const denominator = d13 * dx + d23 * dy + d33 * dz
  if (Math.abs(denominator) < 1e-9) return null

  const xDot = -c * ((d11 * dx + d21 * dy + d31 * dz) / denominator)
  const yDot = -c * ((d12 * dx + d22 * dy + d32 * dz) / denominator)
  const col = ((xDot - xx0) + dimX) * -1 / pixelSpacing
  const row = ((yDot - yy0) + dimY) * -1 / pixelSpacing

  if (!Number.isFinite(col) || !Number.isFinite(row)) return null
  return [Math.round(col), Math.round(row)]
}

function coordinateInsideExtent(coordinate: [number, number], extent?: number[]): boolean {
  if (!extent || extent.length < 4) return true
  return coordinate[0] >= extent[0]
    && coordinate[0] <= extent[2]
    && coordinate[1] >= extent[1]
    && coordinate[1] <= extent[3]
}

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
  const mapRef = useRef<OlMap | null>(null)

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

    if (mapRef.current) {
      mapRef.current.setTarget(undefined)
      mapRef.current = null
    }

    if (!activePhoto || !containerRef.current) return

    setViewerLoading(true)
    setViewerError(null)

    const load = async () => {
      try {
        const [
          { default: Map },
          { default: View },
          { default: WebGLTile },
          { default: GeoTIFF },
          { default: Projection },
          { defaults: defaultControls },
        ] = await Promise.all([
          import('ol/Map.js'),
          import('ol/View.js'),
          import('ol/layer/WebGLTile.js'),
          import('ol/source/GeoTIFF.js'),
          import('ol/proj/Projection.js'),
          import('ol/control/defaults.js'),
        ])

        if (cancelled || !containerRef.current) return

        const cogProxyUrl = `/api/skraafoto/cog?url=${encodeUpstreamUrl(activePhoto.cogUrl)}`
        const source = new GeoTIFF({
          convertToRGB: true,
          transition: 0,
          sources: [{ url: cogProxyUrl, bands: [1, 2, 3] }],
        })

        const layer = new WebGLTile({ source, preload: 0 })
        const sourceView = await source.getView()
        if (cancelled || !containerRef.current) return

        const projection = new Projection({
          code: `skraafoto-${activePhoto.id}`,
          units: 'pixels',
          metersPerUnit: 1,
        })

        const baseResolutions = sourceView.resolutions ? Array.from(sourceView.resolutions) : undefined
        let resolutions = baseResolutions
        if (baseResolutions && baseResolutions.length > 0) {
          const last = baseResolutions[baseResolutions.length - 1]
          resolutions = [...baseResolutions, last / 2, last / 4]
        }

        const { easting, northing } = wgs84ToUtm32(lat, lng)
        const projectedPoint = getImageCoordinate(activePhoto, easting, northing)
        const inheritedMapZoom = (window as UrbanExplorerWindow).__urbanExplorerMapZoom
        const requestedZoom = Number.isFinite(inheritedMapZoom)
          ? inheritedMapZoom! - MAP_TO_SKRAAFOTO_ZOOM_DIFFERENCE
          : DEFAULT_SKRAAFOTO_ZOOM
        const maxZoom = resolutions ? Math.max(0, resolutions.length - 1) : 10
        const inheritedZoom = Math.min(maxZoom, Math.max(1, requestedZoom))
        const inheritedCenter = projectedPoint && coordinateInsideExtent(projectedPoint, sourceView.extent)
          ? projectedPoint
          : sourceView.center

        const view = new View({
          ...sourceView,
          projection,
          resolutions,
          center: inheritedCenter,
          zoom: inheritedZoom,
        })

        const map = new Map({
          target: containerRef.current,
          layers: [layer],
          view,
          controls: defaultControls({ attribution: false }),
        })

        mapRef.current = map
        // OpenLayers kan måle modalens størrelse et øjeblik før layoutet er færdigt.
        // Genberegn efter første paint, uden at ændre center eller zoom.
        requestAnimationFrame(() => {
          if (!cancelled) map.updateSize()
        })
        setViewerLoading(false)
      } catch (err) {
        if (!cancelled) {
          setViewerError(err instanceof Error ? err.message : 'Kunne ikke hente skråfoto')
          setViewerLoading(false)
        }
      }
    }

    void load()

    return () => {
      cancelled = true
      if (mapRef.current) {
        mapRef.current.setTarget(undefined)
        mapRef.current = null
      }
    }
  }, [activePhoto?.id, lat, lng])

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
