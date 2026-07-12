'use client'

import { useState } from 'react'
import type { FormEvent } from 'react'

interface UserRow {
  id: string
  firstName: string
  email: string
  isAdmin: boolean
  lastLoginAt: string | null
  createdAt: string
}

export default function UsersManager({ initialUsers, currentUserId }: { initialUsers: UserRow[]; currentUserId: string }) {
  const [users, setUsers] = useState(initialUsers)
  const [firstName, setFirstName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [isAdmin, setIsAdmin] = useState(false)
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  async function handleCreate(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    setSuccess(false)
    setCreating(true)
    try {
      const res = await fetch('/api/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ firstName, email, password, isAdmin }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error || 'Kunne ikke oprette bruger')
        return
      }
      setUsers(prev => [...prev, { id: data.id, firstName: firstName.trim(), email: email.trim().toLowerCase(), isAdmin, lastLoginAt: null, createdAt: new Date().toISOString() }])
      setFirstName('')
      setEmail('')
      setPassword('')
      setIsAdmin(false)
      setSuccess(true)
    } catch {
      setError('Kunne ikke oprette bruger')
    } finally {
      setCreating(false)
    }
  }

  async function handleDelete(id: string) {
    if (!confirm('Slet denne bruger? Alle deres pins, kategorier og delte links bliver slettet permanent.')) return
    setDeletingId(id)
    try {
      const res = await fetch(`/api/users/${id}`, { method: 'DELETE' })
      const data = await res.json()
      if (!res.ok) {
        alert(data.error || 'Kunne ikke slette bruger')
        return
      }
      setUsers(prev => prev.filter(u => u.id !== id))
    } finally {
      setDeletingId(null)
    }
  }

  return (
    <div className="space-y-6">
      <form onSubmit={handleCreate} className="card space-y-3">
        <label className="block text-sm font-medium text-gray-300">Ny bruger</label>
        <div>
          <input className="input" placeholder="Fornavn" value={firstName} onChange={e => setFirstName(e.target.value)} required />
        </div>
        <div>
          <input className="input" type="email" placeholder="Email" value={email} onChange={e => setEmail(e.target.value)} required />
        </div>
        <div>
          <input className="input" type="password" placeholder="Midlertidig adgangskode" value={password} onChange={e => setPassword(e.target.value)} required minLength={12} />
          <p className="text-xs text-gray-500 mt-1">Mindst 12 tegn. Brugeren bliver bedt om at vælge sin egen adgangskode ved første login.</p>
        </div>
        <div>
          <p className="text-xs text-gray-500 mb-1.5">Rolle</p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setIsAdmin(false)}
              className={`flex-1 px-3 py-2 rounded-lg text-sm font-medium border transition-colors ${
                !isAdmin ? 'border-rust-600 bg-rust-600/15 text-rust-500' : 'border-void-600 text-gray-400 hover:bg-void-800'
              }`}
            >
              Bruger
            </button>
            <button
              type="button"
              onClick={() => setIsAdmin(true)}
              className={`flex-1 px-3 py-2 rounded-lg text-sm font-medium border transition-colors ${
                isAdmin ? 'border-rust-600 bg-rust-600/15 text-rust-500' : 'border-void-600 text-gray-400 hover:bg-void-800'
              }`}
            >
              Admin
            </button>
          </div>
          <p className="text-xs text-gray-500 mt-1.5">
            {isAdmin ? 'Kan oprette brugere og ændre indstillinger.' : 'Har adgang til kort, pins, kategorier og delte links — ikke Indstillinger.'}
          </p>
        </div>

        {error && <p className="text-sm text-red-400 bg-red-900/20 border border-red-800/40 rounded-lg px-3 py-2">{error}</p>}
        {success && <p className="text-sm text-emerald-400 bg-emerald-900/20 border border-emerald-800/40 rounded-lg px-3 py-2">Bruger oprettet</p>}

        <button type="submit" className="btn-primary" disabled={creating}>
          {creating ? 'Opretter...' : 'Opret bruger'}
        </button>
      </form>

      <div className="space-y-2">
        {users.map(u => (
          <div key={u.id} className="card !p-3 flex items-center gap-3">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-gray-200 truncate">
                {u.firstName}{' '}
                <span className={`text-xs font-normal ${u.isAdmin ? 'text-rust-500' : 'text-gray-500'}`}>
                  · {u.isAdmin ? 'admin' : 'bruger'}
                </span>
                {u.id === currentUserId && <span className="text-xs text-gray-500 font-normal"> · dig</span>}
              </p>
              <p className="text-xs text-gray-500 truncate">{u.email}</p>
            </div>
            <button
              onClick={() => handleDelete(u.id)}
              disabled={deletingId === u.id || u.id === currentUserId}
              title={u.id === currentUserId ? 'Du kan ikke slette din egen konto' : 'Slet bruger'}
              className="text-gray-500 hover:text-red-400 transition-colors p-1.5 shrink-0 disabled:opacity-30 disabled:hover:text-gray-500 disabled:cursor-not-allowed"
              aria-label="Slet bruger"
            >
              🗑️
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}
