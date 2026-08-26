'use client'

import { useEffect, useState } from 'react'

type MapProvider = 'maptiler' | 'esri'

const OPTIONS: { id: MapProvider; label: string; description: string }[] = [
  {
    id: 'esri',
    label: 'Esri World Imagery (gratis, ingen nøgle)',
    description: 'Ingen API-nøgle nødvendig og ingen fare for at ramme et forbrugsloft, men lidt lavere detaljegrad nogle steder.',
  },
  {
    id: 'maptiler',
    label: 'MapTiler',
    description: 'Kræver en gyldig API-nøgle nedenfor. Kan holde helt op med at virke hvis kontoens forbrugsloft rammes.',
  },
]

export default function MapProviderSettingsForm() {
  const [provider, setProvider] = useState<MapProvider | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/settings/map-provider')
      .then(res => res.json())
      .then(data => setProvider(data.provider === 'maptiler' ? 'maptiler' : 'esri'))
      .catch(() => setProvider('esri'))
  }, [])

  async function choose(next: MapProvider) {
    if (next === provider || saving) return
    setError(null)
    setSaving(true)
    const previous = provider
    setProvider(next)
    try {
      const res = await fetch('/api/settings/map-provider', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: next }),
      })
      if (!res.ok) throw new Error()
    } catch {
      setProvider(previous)
      setError('Kunne ikke skifte kortudbyder')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-3">
      <div>
        <p className="text-sm font-medium text-gray-300">Kortudbyder</p>
        <p className="text-xs text-gray-500 mt-0.5">Hvilken kilde satellit-/kortbilleder hentes fra</p>
      </div>

      <div className="space-y-2">
        {OPTIONS.map(option => {
          const active = provider === option.id
          return (
            <button
              key={option.id}
              type="button"
              onClick={() => choose(option.id)}
              disabled={provider === null || saving}
              className={`w-full text-left rounded-xl border p-3 transition-colors ${
                active ? 'border-rust-500 bg-rust-600/15' : 'border-void-700 hover:bg-void-800'
              }`}
              aria-pressed={active}
            >
              <div className="flex items-center gap-2">
                <span
                  className={`h-3.5 w-3.5 shrink-0 rounded-full border-2 ${
                    active ? 'border-rust-500 bg-rust-500' : 'border-gray-600'
                  }`}
                />
                <span className="text-sm font-semibold text-gray-100">{option.label}</span>
              </div>
              <p className="text-xs text-gray-500 mt-1 ml-5.5">{option.description}</p>
            </button>
          )
        })}
      </div>

      {error && <p className="text-sm text-red-400 bg-red-900/20 border border-red-800/40 rounded-lg px-3 py-2">{error}</p>}
    </div>
  )
}
