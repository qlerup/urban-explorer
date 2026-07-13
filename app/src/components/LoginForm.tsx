'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

export default function LoginForm({ hubManaged = false }: { hubManaged?: boolean }) {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [mustChangePassword, setMustChangePassword] = useState(false)
  const [newPassword, setNewPassword] = useState('')
  const [newPassword2, setNewPassword2] = useState('')

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
      if (data.passwordChangeRequired) {
        setMustChangePassword(true)
        return
      }
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

  async function handleChangePassword(e: React.FormEvent) {
    e.preventDefault()
    if (newPassword !== newPassword2) {
      setError('De to adgangskoder matcher ikke')
      return
    }
    if (newPassword.length < 6) {
      setError('Adgangskoden skal være mindst 6 tegn')
      return
    }
    setError(null)
    setLoading(true)
    try {
      const res = await fetch('/api/auth/change-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: email,
          currentPassword: password,
          password: newPassword,
          confirmPassword: newPassword2,
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error || 'Der skete en fejl')
        return
      }
      router.push('/dashboard/kort')
      router.refresh()
    } catch {
      setError('Kunne ikke skifte adgangskoden')
    } finally {
      setLoading(false)
    }
  }

  if (mustChangePassword) {
    return (
      <form onSubmit={handleChangePassword} className="space-y-4">
        <p className="text-sm text-emerald-300 bg-emerald-900/20 border border-emerald-800/40 rounded-lg px-3 py-2">
          Første login: Vælg din egen adgangskode for at fortsætte
        </p>
        <div>
          <label className="block text-sm font-medium text-gray-300 mb-1.5">Ny adgangskode</label>
          <input
            className="input"
            type="password"
            value={newPassword}
            onChange={e => setNewPassword(e.target.value)}
            minLength={6}
            autoComplete="new-password"
            required
            autoFocus
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-300 mb-1.5">Gentag ny adgangskode</label>
          <input
            className="input"
            type="password"
            value={newPassword2}
            onChange={e => setNewPassword2(e.target.value)}
            minLength={6}
            autoComplete="new-password"
            required
          />
          {newPassword2.length > 0 && newPassword !== newPassword2 && (
            <p className="text-sm text-red-400 mt-1.5">Adgangskoderne matcher ikke</p>
          )}
        </div>

        {error && <p className="text-sm text-red-400 bg-red-900/20 border border-red-800/40 rounded-lg px-3 py-2">{error}</p>}

        <button type="submit" className="btn-primary" disabled={loading}>
          {loading ? 'Gemmer...' : 'Gem og log ind'}
        </button>
      </form>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label className="block text-sm font-medium text-gray-300 mb-1.5">
          {hubManaged ? 'FjordHub-brugernavn' : 'Email'}
        </label>
        <input
          className="input"
          type={hubManaged ? 'text' : 'email'}
          value={email}
          onChange={e => setEmail(e.target.value)}
          required
          autoFocus
        />
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
