'use client'

import { useState } from 'react'
import type { Pin, PinRoute, RoutePoint } from '@/types/pin'
import { haversineMeters, formatDistance } from '@/lib/geo'

interface Props {
  pins: Pin[]
  points: RoutePoint[]
  onClose: () => void
  onSaved: (pinId: string, route: PinRoute) => void
}

export default function SaveRouteModal({ pins, points, onClose, onSaved }: Props) {
  const [name, setName] = useState('')
  const [savingId, setSavingId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const lastPoint = points[points.length - 1]
  const sortedPins = [...pins].sort(
    (a, b) =>
      haversineMeters(lastPoint, { lat: a.latitude, lng: a.longitude }) -
      haversineMeters(lastPoint, { lat: b.latitude, lng: b.longitude })
  )

  async function handleSave(pinId: string) {
    if (!name.trim()) {
      setError('Giv ruten et navn først')
      return
    }
    setSavingId(pinId)
    setError(null)
    try {
      const res = await fetch(`/api/pins/${pinId}/rute`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), points }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error || 'Kunne ikke gemme rute')
        return
      }
      onSaved(pinId, data.route)
    } catch {
      setError('Kunne ikke gemme rute')
    } finally {
      setSavingId(null)
    }
  }

  return (
    <div className="fixed inset-0 z-[2100] flex items-end md:items-center justify-center bg-black/60" onClick={onClose}>
      <div
        className="w-full md:max-w-sm bg-void-900 md:rounded-2xl rounded-t-2xl border border-void-700 max-h-[80vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-void-700 sticky top-0 bg-void-900">
          <h2 className="font-semibold text-gray-100">Gem rute</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-200 text-2xl leading-none px-1">×</button>
        </div>

        <div className="p-5 space-y-4">
          <div>
            <label htmlFor="route-name-input" className="text-xs text-gray-500 mb-1 block">Navn på ruten</label>
            <input
              id="route-name-input"
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="Fx &quot;Bagvej&quot; eller &quot;Vinter-indgang&quot;"
              maxLength={100}
              autoFocus
              className="input"
            />
          </div>

          <p className="text-sm text-gray-500">Vælg hvilken pin ruten hører til. Nærmeste pin til rutens slutpunkt vises øverst.</p>

          {error && <p className="text-sm text-red-400 bg-red-900/20 border border-red-800/40 rounded-lg px-3 py-2">{error}</p>}

          {sortedPins.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-8">Du har ingen pins endnu. Opret en pin først.</p>
          ) : (
            <div className="space-y-2">
              {sortedPins.map(pin => (
                <button
                  key={pin.id}
                  type="button"
                  onClick={() => handleSave(pin.id)}
                  disabled={savingId !== null}
                  className="w-full flex items-center justify-between gap-3 border border-void-700 hover:border-void-500 rounded-xl px-4 py-3 text-left transition-colors disabled:opacity-50"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-gray-200 truncate">{pin.name}</p>
                    {pin.routes.length > 0 && (
                      <p className="text-xs text-gray-500 mt-0.5">{pin.routes.length} rute{pin.routes.length > 1 ? 'r' : ''} gemt</p>
                    )}
                  </div>
                  <span className="text-xs text-gray-500 shrink-0">
                    {savingId === pin.id ? 'Gemmer...' : formatDistance(haversineMeters(lastPoint, { lat: pin.latitude, lng: pin.longitude }))}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
