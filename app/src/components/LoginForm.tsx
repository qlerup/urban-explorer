'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

export default function LoginForm() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error || 'Der skete en fejl')
        return
      }
      router.push('/dashboard/kort')
      router.refresh()
    } catch {
      setError('Kunne ikke logge ind')
    } finally {
      setLoading(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label className="block text-sm font-medium text-gray-300 mb-1.5">Email</label>
        <input className="input" type="email" value={email} onChange={e => setEmail(e.target.value)} required autoFocus />
      </div>
      <div>
        <label className="block text-sm font-medium text-gray-300 mb-1.5">Adgangskode</label>
        <input className="input" type="password" value={password} onChange={e => setPassword(e.target.value)} required />
      </div>

      {error && <p className="text-sm text-red-400 bg-red-900/20 border border-red-800/40 rounded-lg px-3 py-2">{error}</p>}

      <button type="submit" className="btn-primary" disabled={loading}>
        {loading ? 'Logger ind...' : 'Log ind'}
      </button>
    </form>
  )
}
