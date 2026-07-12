'use client'

import { useEffect, useState } from 'react'

export default function MaptilerSettingsForm() {
  const [key, setKey] = useState('')
  const [status, setStatus] = useState<{ hasKey: boolean; maskedKey: string | null } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    fetch('/api/settings/maptiler')
      .then(res => res.json())
      .then(data => setStatus(data))
      .catch(() => {})
  }, [])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setSuccess(false)
    setSaving(true)
    try {
      const res = await fetch('/api/settings/maptiler', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error || 'Kunne ikke gemme nøglen')
        return
      }
      setSuccess(true)
      setKey('')
      const refreshed = await fetch('/api/settings/maptiler').then(r => r.json())
      setStatus(refreshed)
    } catch {
      setError('Kunne ikke gemme nøglen')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <p className="text-xs text-gray-500 mb-1">Status</p>
        {status === null ? (
          <p className="text-sm text-gray-400">Henter...</p>
        ) : status.hasKey ? (
          <p className="text-sm text-emerald-400">✓ Nøgle er sat ({status.maskedKey})</p>
        ) : (
          <p className="text-sm text-amber-400">Ingen nøgle sat endnu — kortet kan ikke vise satellitbilleder</p>
        )}
      </div>

      <form onSubmit={handleSubmit} className="space-y-3">
        <div>
          <label className="block text-sm font-medium text-gray-300 mb-1.5">MapTiler API-nøgle</label>
          <input
            className="input"
            type="text"
            value={key}
            onChange={e => setKey(e.target.value)}
            placeholder="Indsæt din MapTiler API-nøgle"
            required
            minLength={10}
          />
          <p className="text-xs text-gray-500 mt-1">
            Opret en gratis konto på{' '}
            <a href="https://cloud.maptiler.com/" target="_blank" rel="noopener noreferrer" className="text-rust-500 hover:underline">
              cloud.maptiler.com
            </a>{' '}
            og find din nøgle under &quot;API Keys&quot;.
          </p>
        </div>

        {error && <p className="text-sm text-red-400 bg-red-900/20 border border-red-800/40 rounded-lg px-3 py-2">{error}</p>}
        {success && <p className="text-sm text-emerald-400 bg-emerald-900/20 border border-emerald-800/40 rounded-lg px-3 py-2">Nøgle gemt</p>}

        <button type="submit" className="btn-primary" disabled={saving}>
          {saving ? 'Gemmer...' : 'Gem nøgle'}
        </button>
      </form>
    </div>
  )
}
