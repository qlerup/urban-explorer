'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

export default function SetupForm() {
  const router = useRouter()
  const [firstName, setFirstName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)
    try {
      const res = await fetch('/api/setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ firstName, email, password, confirmPassword }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error || 'Der skete en fejl')
        return
      }
      router.push('/login')
      router.refresh()
    } catch {
      setError('Kunne ikke oprette konto')
    } finally {
      setLoading(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label className="block text-sm font-medium text-gray-300 mb-1.5">Fornavn</label>
        <input className="input" value={firstName} onChange={e => setFirstName(e.target.value)} required autoFocus />
      </div>
      <div>
        <label className="block text-sm font-medium text-gray-300 mb-1.5">Email</label>
        <input className="input" type="email" value={email} onChange={e => setEmail(e.target.value)} required />
      </div>
      <div>
        <label className="block text-sm font-medium text-gray-300 mb-1.5">Adgangskode</label>
        <input className="input" type="password" value={password} onChange={e => setPassword(e.target.value)} required minLength={12} />
        <p className="text-xs text-gray-500 mt-1">Mindst 12 tegn</p>
      </div>
      <div>
        <label className="block text-sm font-medium text-gray-300 mb-1.5">Bekræft adgangskode</label>
        <input className="input" type="password" value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} required minLength={12} />
      </div>

      {error && <p className="text-sm text-red-400 bg-red-900/20 border border-red-800/40 rounded-lg px-3 py-2">{error}</p>}

      <button type="submit" className="btn-primary" disabled={loading}>
        {loading ? 'Opretter...' : 'Opret admin-konto'}
      </button>
    </form>
  )
}
