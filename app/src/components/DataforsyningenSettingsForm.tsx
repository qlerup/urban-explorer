'use client'

import { useEffect, useState } from 'react'

export default function DataforsyningenSettingsForm() {
  const [token, setToken] = useState('')
  const [status, setStatus] = useState<{ hasToken: boolean; maskedToken: string | null } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    fetch('/api/settings/dataforsyningen')
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
      const res = await fetch('/api/settings/dataforsyningen', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error || 'Kunne ikke gemme token')
        return
      }
      setSuccess(true)
      setToken('')
      const refreshed = await fetch('/api/settings/dataforsyningen').then(r => r.json())
      setStatus(refreshed)
    } catch {
      setError('Kunne ikke gemme token')
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
        ) : status.hasToken ? (
          <p className="text-sm text-emerald-400">✓ Token er sat ({status.maskedToken})</p>
        ) : (
          <p className="text-sm text-amber-400">Ingen token sat endnu — Luftfoto Danmark, Vejnavne og Skråfoto er deaktiveret på kortet</p>
        )}
      </div>

      <form onSubmit={handleSubmit} className="space-y-3">
        <div>
          <label className="block text-sm font-medium text-gray-300 mb-1.5">Dataforsyningen token</label>
          <input
            className="input"
            type="text"
            value={token}
            onChange={e => setToken(e.target.value)}
            placeholder="Indsæt din Dataforsyningen token"
            required
            minLength={10}
          />
          <p className="text-xs text-gray-500 mt-1">
            Opret en gratis konto på{' '}
            <a href="https://dataforsyningen.dk/" target="_blank" rel="noopener noreferrer" className="text-rust-500 hover:underline">
              dataforsyningen.dk
            </a>{' '}
            og opret en token under &quot;Administrer token til webservices og API&apos;er&quot;.
          </p>
        </div>

        {error && <p className="text-sm text-red-400 bg-red-900/20 border border-red-800/40 rounded-lg px-3 py-2">{error}</p>}
        {success && <p className="text-sm text-emerald-400 bg-emerald-900/20 border border-emerald-800/40 rounded-lg px-3 py-2">Token gemt</p>}

        <button type="submit" className="btn-primary" disabled={saving}>
          {saving ? 'Gemmer...' : 'Gem token'}
        </button>
      </form>
    </div>
  )
}
