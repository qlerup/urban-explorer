'use client'

import { useEffect, useRef, useState, type ComponentProps } from 'react'
import type * as Leaflet from 'leaflet'
import MapView from './MapView'
import OfflineMapManager from './OfflineMapManager'

type Props = ComponentProps<typeof MapView>

type UrbanExplorerWindow = Window & {
  __urbanExplorerMapZoom?: number
  __urbanExplorerMapCenter?: [number, number]
  __urbanExplorerLeafletZoomHookInstalled?: boolean
  __urbanExplorerLeafletMap?: Leaflet.Map
}

export default function MapViewLoader(props: Props) {
  const [ready, setReady] = useState(false)
  const firstFrameRef = useRef<number | null>(null)
  const secondFrameRef = useRef<number | null>(null)

  useEffect(() => {
    let cancelled = false

    async function prepareMap() {
      // MarkerCluster extends Leaflet at module evaluation time. On a cold load,
      // loading both chunks in parallel can race. Load Leaflet first so the
      // plugin always sees an initialized Leaflet module.
      const leafletModule = await import('leaflet')
      const L = (leafletModule as unknown as { default?: typeof Leaflet }).default
        ?? (leafletModule as unknown as typeof Leaflet)

      // Keep the current Leaflet view available to skraafoto, route planner and offlinekort.
      const browserWindow = window as UrbanExplorerWindow
      if (!browserWindow.__urbanExplorerLeafletZoomHookInstalled) {
        L.Map.addInitHook(function (this: Leaflet.Map) {
          browserWindow.__urbanExplorerLeafletMap = this
          const syncView = () => {
            const center = this.getCenter()
            browserWindow.__urbanExplorerMapZoom = this.getZoom()
            browserWindow.__urbanExplorerMapCenter = [center.lat, center.lng]
          }
          this.on('zoomend moveend', syncView)
          this.whenReady(() => {
            syncView()
            window.dispatchEvent(new CustomEvent('urban-explorer-map-ready'))
          })
        })
        browserWindow.__urbanExplorerLeafletZoomHookInstalled = true
      }

      await import('leaflet.markercluster')

      if (cancelled) return

      // Give the dashboard layout two paint frames before MapView creates the
      // Leaflet instance. This prevents Leaflet from measuring a transient
      // zero/incorrect container size on the first navigation after login.
      firstFrameRef.current = requestAnimationFrame(() => {
        secondFrameRef.current = requestAnimationFrame(() => {
          if (!cancelled) setReady(true)
        })
      })
    }

    void prepareMap().catch(error => {
      console.error('Kortmoduler kunne ikke indlæses', error)
      // Let MapView attempt its own imports so a transient preload error does
      // not leave the UI stuck on the loader forever.
      if (!cancelled) setReady(true)
    })

    return () => {
      cancelled = true
      if (firstFrameRef.current !== null) cancelAnimationFrame(firstFrameRef.current)
      if (secondFrameRef.current !== null) cancelAnimationFrame(secondFrameRef.current)
    }
  }, [])

  if (!ready) {
    return (
      <div className="relative w-full h-[calc(100dvh-4rem)] bg-void-900 flex items-center justify-center">
        <span className="text-sm text-gray-500">Indlæser kort...</span>
      </div>
    )
  }

  return (
    <div className="relative">
      <MapView {...props} />
      <OfflineMapManager
        initialPins={props.initialPins}
        categories={props.categories}
        geodanmarkAvailable={Boolean(props.geodanmarkAvailable)}
      />
    </div>
  )
}
