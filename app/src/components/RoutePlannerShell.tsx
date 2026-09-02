'use client'

import { useState } from 'react'
import type { Category, Pin } from '@/types/pin'
import RoutePlannerMap from '@/components/RoutePlannerMap'

type MapProvider = 'maptiler' | 'esri'

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
  selectedPinIds: string[]
  stopLabels: Record<string, string>
  stopCoordinates: Record<string, { lat: number; lng: number }>
}

interface SavedRouteDetail {
  id: string
  name: string
  routeData: RouteResult
}

interface SavedRouteSummary {
  id: string
  name: string
  distanceKm: number | null
  durationSeconds: number | null
  pinCount: number
  createdAt: string
}

interface Props {
  maptilerKey: string
  mapProvider: MapProvider
  geodanmarkAvailable: boolean
  initialPins: Pin[]
  categories: Category[]
  initialSavedRoute?: SavedRouteDetail | null
}

function formatDuration(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds)) return 'Ukendt tid'
  const minutes = Math.max(1, Math.round(seconds / 60))
  if (minutes < 60) return `${minutes} min.`
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return rest ? `${hours} t. ${rest} min.` : `${hours} t.`
}

function formatDistance(km: number | null): string {
  if (km === null || !Number.isFinite(km)) return 'Ukendt afstand'
  return `${km.toLocaleString('da-DK', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} km`
}

export default function RoutePlannerShell({
  maptilerKey,
  mapProvider,
  geodanmarkAvailable,
  initialPins,
  categories,
  initialSavedRoute = null,
}: Props) {
  const [activeSavedRoute, setActiveSavedRoute] = useState<SavedRouteDetail | null>(initialSavedRoute)
  const [routeInstance, setRouteInstance] = useState(0)
  const [showSavedRoutes, setShowSavedRoutes] = useState(false)
  const [savedRoutes, setSavedRoutes] = useState<SavedRouteSummary[]>([])
  const [loadingList, setLoadingList] = useState(false)
  const [loadingRouteId, setLoadingRouteId] = useState<string | null>(null)
  const [savedRoutesError, setSavedRoutesError] = useState<string | null>(null)

  async function openSavedRoutes() {
    setShowSavedRoutes(true)
    setLoadingList(true)
    setSavedRoutesError(null)

    try {
      const response = await fetch('/api/route-planner/saved', { cache: 'no-store' })
      const data = await response.json() as { routes?: SavedRouteSummary[]; error?: string }
      if (!response.ok) throw new Error(data.error || 'De gemte ruter kunne ikke hentes')
      setSavedRoutes(Array.isArray(data.routes) ? data.routes : [])
    } catch (error) {
      setSavedRoutesError(error instanceof Error ? error.message : 'De gemte ruter kunne ikke hentes')
    } finally {
      setLoadingList(false)
    }
  }

  async function loadSavedRoute(routeId: string) {
    if (loadingRouteId) return
    setLoadingRouteId(routeId)
    setSavedRoutesError(null)

    try {
      const response = await fetch(`/api/route-planner/saved/${encodeURIComponent(routeId)}`, { cache: 'no-store' })
      const data = await response.json() as SavedRouteDetail & { error?: string }
      if (!response.ok || !data.id || !data.routeData) throw new Error(data.error || 'Ruten kunne ikke indlæses')

      setActiveSavedRoute({ id: data.id, name: data.name, routeData: data.routeData })
      setRouteInstance(previous => previous + 1)
      setShowSavedRoutes(false)
    } catch (error) {
      setSavedRoutesError(error instanceof Error ? error.message : 'Ruten kunne ikke indlæses')
    } finally {
      setLoadingRouteId(null)
    }
  }

  return (
    <div className="relative">
      <RoutePlannerMap
        key={`${activeSavedRoute?.id ?? 'new'}-${routeInstance}`}
        maptilerKey={maptilerKey}
        mapProvider={mapProvider}
        geodanmarkAvailable={geodanmarkAvailable}
        initialPins={initialPins}
        categories={categories}
        initialSavedRoute={activeSavedRoute}
      />

      <button
        type="button"
        onClick={() => void openSavedRoutes()}
        className="btn-secondary absolute bottom-20 right-2 z-[900] whitespace-nowrap px-4 py-3 shadow-xl md:bottom-4 md:right-4"
      >
        🗂️ Gemte ruter
      </button>

      {showSavedRoutes && (
        <div
          className="fixed inset-0 z-[2300] flex items-center justify-center bg-black/65 px-4"
          onClick={() => { if (!loadingRouteId) setShowSavedRoutes(false) }}
        >
          <div
            className="flex max-h-[78dvh] w-full max-w-md flex-col overflow-hidden rounded-2xl border border-void-700 bg-void-900 shadow-2xl"
            onClick={event => event.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-4 border-b border-void-700 px-5 py-4">
              <div>
                <h2 className="text-lg font-semibold text-gray-100">Gemte ruter</h2>
                <p className="mt-1 text-sm text-gray-400">Vælg en rute for at vise den på kortet.</p>
              </div>
              <button
                type="button"
                disabled={Boolean(loadingRouteId)}
                onClick={() => setShowSavedRoutes(false)}
                className="text-2xl leading-none text-gray-500 hover:text-gray-200 disabled:opacity-40"
                aria-label="Luk gemte ruter"
              >
                ×
              </button>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto p-4">
              {loadingList ? (
                <div className="flex items-center justify-center gap-2 py-10 text-sm text-gray-400">
                  <span className="h-4 w-4 animate-spin rounded-full border-2 border-gray-500/40 border-t-gray-200" aria-hidden="true" />
                  <span>Henter gemte ruter…</span>
                </div>
              ) : savedRoutesError ? (
                <div className="rounded-xl border border-red-900/60 bg-red-950/70 px-3 py-3 text-sm text-red-200">
                  {savedRoutesError}
                </div>
              ) : savedRoutes.length === 0 ? (
                <div className="py-10 text-center text-sm text-gray-500">
                  Du har ikke gemt nogen ruter endnu.
                </div>
              ) : (
                <div className="space-y-2.5">
                  {savedRoutes.map(route => (
                    <div key={route.id} className="rounded-xl border border-void-700 bg-void-800/70 p-3">
                      <div className="flex items-center justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <p className="truncate font-semibold text-gray-100">{route.name}</p>
                          <p className="mt-1 text-xs text-gray-400">
                            {route.pinCount} pins · {formatDistance(route.distanceKm)} · {formatDuration(route.durationSeconds)}
                          </p>
                          <p className="mt-1 text-[11px] text-gray-600">
                            Gemt {new Date(route.createdAt).toLocaleDateString('da-DK')}
                          </p>
                        </div>
                        <button
                          type="button"
                          disabled={Boolean(loadingRouteId)}
                          onClick={() => void loadSavedRoute(route.id)}
                          className="btn-primary flex min-w-[92px] shrink-0 items-center justify-center gap-2 px-3 py-2 disabled:cursor-wait disabled:opacity-60"
                        >
                          {loadingRouteId === route.id ? (
                            <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" aria-hidden="true" />
                          ) : null}
                          <span>{loadingRouteId === route.id ? 'Indlæser…' : 'Indlæs'}</span>
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
