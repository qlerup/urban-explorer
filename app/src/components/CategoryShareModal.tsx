'use client'

import { useEffect, useState } from 'react'
import type { Category } from '@/types/pin'

type ShareLevel = 'none' | 'view' | 'edit'

interface UserOption {
  id: string
  firstName: string
}

interface Props {
  category: Category
  onClose: () => void
  onSaved: (shareCount: number) => void
}

const LEVELS: { key: ShareLevel; label: string }[] = [
  { key: 'none', label: 'Ingen' },
  { key: 'view', label: 'Vis' },
  { key: 'edit', label: 'Rediger' },
]

export default function CategoryShareModal({ category, onClose, onSaved }: Props) {
  const [users, setUsers] = useState<UserOption[]>([])
  const [levels, setLevels] = useState<Record<string, ShareLevel>>({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const res = await fetch(`/api/categories/${category.id}/shares`)
        const data = await res.json()
        if (!res.ok) {
          if (!cancelled) setError(data.error || 'Kunne ikke hente delinger')
          return
        }
        if (cancelled) return
        setUsers(data.users)
        const next: Record<string, ShareLevel> = {}
        for (const share of data.shares as { userId: string; canEdit: boolean }[]) {
          next[share.userId] = share.canEdit ? 'edit' : 'view'
        }
        setLevels(next)
      } catch {
        if (!cancelled) setError('Kunne ikke hente delinger')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [category.id])

  async function handleSave() {
    setSaving(true)
    setError(null)
    try {
      const shares = Object.entries(levels)
        .filter(([, level]) => level !== 'none')
        .map(([userId, level]) => ({ userId, canEdit: level === 'edit' }))
      const res = await fetch(`/api/categories/${category.id}/shares`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ shares }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error || 'Kunne ikke gemme delinger')
        return
      }
      onSaved(data.shareCount)
    } catch {
      setError('Kunne ikke gemme delinger')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="ue-modal-backdrop fixed inset-0 z-[2000] flex items-end md:items-center justify-center bg-black/60" onClick={onClose}>
      <div
        className="ue-modal-panel w-full md:max-w-sm bg-void-900 md:rounded-2xl rounded-t-2xl border border-void-700 max-h-[85vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-void-700 sticky top-0 bg-void-900">
          <div className="flex items-center gap-2.5 min-w-0">
            <span className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: category.color }} />
            <h2 className="font-semibold text-gray-100 truncate">Del &quot;{category.name}&quot;</h2>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-200 text-2xl leading-none px-1">×</button>
        </div>

        <div className="p-5 space-y-4">
          <p className="text-xs text-gray-500">
            <strong className="text-gray-400">Vis</strong>: kan se kategoriens pins på kort og liste.{' '}
            <strong className="text-gray-400">Rediger</strong>: kan også tilføje og redigere pins i kategorien.
          </p>

          {loading ? (
            <p className="text-sm text-gray-500 text-center py-6">Henter brugere...</p>
          ) : users.length === 0 ? (
            <p className="text-sm text-gray-500 text-center py-6">
              Der er ingen andre brugere at dele med endnu.
            </p>
          ) : (
            <div className="space-y-2">
              {users.map(user => {
                const level = levels[user.id] ?? 'none'
                return (
                  <div key={user.id} className="border border-void-700 rounded-xl p-3">
                    <p className="text-sm font-medium text-gray-200 mb-2 truncate">{user.firstName}</p>
                    <div className="flex gap-1.5">
                      {LEVELS.map(option => (
                        <button
                          key={option.key}
                          type="button"
                          onClick={() => setLevels(prev => ({ ...prev, [user.id]: option.key }))}
                          className={`flex-1 px-2 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                            level === option.key
                              ? option.key === 'none'
                                ? 'border-void-500 bg-void-700 text-gray-200'
                                : 'border-rust-600 bg-rust-600/15 text-rust-500'
                              : 'border-void-600 text-gray-400 hover:bg-void-800'
                          }`}
                        >
                          {option.label}
                        </button>
                      ))}
                    </div>
                  </div>
                )
              })}
            </div>
          )}

          {error && <p className="text-sm text-red-400 bg-red-900/20 border border-red-800/40 rounded-lg px-3 py-2">{error}</p>}

          <div className="flex gap-2 pt-1">
            <button onClick={onClose} className="btn-secondary flex-1">Annuller</button>
            <button
              onClick={handleSave}
              disabled={saving || loading || users.length === 0}
              className="btn-primary flex-1"
            >
              {saving ? 'Gemmer...' : 'Gem deling'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
