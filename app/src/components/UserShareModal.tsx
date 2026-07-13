'use client'

import { useEffect, useMemo, useState } from 'react'

interface UserOption {
  id: string
  firstName: string
}

interface CategoryOption {
  id: string
  name: string
  color: string
}

interface ShareState {
  categoryIds: string[]
  uncategorized: boolean
  canEdit: boolean
}

const EMPTY_SHARE: ShareState = { categoryIds: [], uncategorized: false, canEdit: false }

function shareSummary(share: ShareState | undefined, categoryCount: number): string {
  if (!share || (share.categoryIds.length === 0 && !share.uncategorized)) return 'Deler ikke'
  const parts: string[] = []
  if (share.categoryIds.length > 0) {
    parts.push(
      share.categoryIds.length === categoryCount
        ? 'alle kategorier'
        : `${share.categoryIds.length} ${share.categoryIds.length === 1 ? 'kategori' : 'kategorier'}`
    )
  }
  if (share.uncategorized) parts.push('pins uden kategori')
  return `Deler ${parts.join(' + ')} · ${share.canEdit ? 'kan redigere' : 'kan se'}`
}

export default function UserShareModal({ onClose }: { onClose: () => void }) {
  const [users, setUsers] = useState<UserOption[]>([])
  const [categories, setCategories] = useState<CategoryOption[]>([])
  const [shares, setShares] = useState<Record<string, ShareState>>({})
  const [expandedUserId, setExpandedUserId] = useState<string | null>(null)
  const [draft, setDraft] = useState<ShareState>(EMPTY_SHARE)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [savedUserId, setSavedUserId] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const res = await fetch('/api/user-shares')
        const data = await res.json()
        if (!res.ok) {
          if (!cancelled) setError(data.error || 'Kunne ikke hente delinger')
          return
        }
        if (cancelled) return
        setUsers(data.users)
        setCategories(data.categories)
        const next: Record<string, ShareState> = {}
        for (const share of data.shares as ({ userId: string } & ShareState)[]) {
          next[share.userId] = {
            categoryIds: share.categoryIds,
            uncategorized: share.uncategorized,
            canEdit: share.canEdit,
          }
        }
        setShares(next)
      } catch {
        if (!cancelled) setError('Kunne ikke hente delinger')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [])

  const allSelected = useMemo(
    () => draft.uncategorized && draft.categoryIds.length === categories.length,
    [draft, categories]
  )

  function openUser(userId: string) {
    if (expandedUserId === userId) {
      setExpandedUserId(null)
      return
    }
    const existing = shares[userId]
    setDraft(existing ? { ...existing, categoryIds: [...existing.categoryIds] } : { ...EMPTY_SHARE, categoryIds: [] })
    setExpandedUserId(userId)
    setError(null)
    setSavedUserId(null)
  }

  function toggleCategory(categoryId: string) {
    setDraft(prev => ({
      ...prev,
      categoryIds: prev.categoryIds.includes(categoryId)
        ? prev.categoryIds.filter(id => id !== categoryId)
        : [...prev.categoryIds, categoryId],
    }))
  }

  function toggleAll() {
    setDraft(prev =>
      allSelected
        ? { ...prev, categoryIds: [], uncategorized: false }
        : { ...prev, categoryIds: categories.map(c => c.id), uncategorized: true }
    )
  }

  async function saveShare(userId: string, share: ShareState) {
    setSaving(true)
    setError(null)
    try {
      const res = await fetch('/api/user-shares', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, ...share }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error || 'Kunne ikke gemme delingen')
        return
      }
      setShares(prev => ({ ...prev, [userId]: share }))
      setSavedUserId(userId)
      setExpandedUserId(null)
    } catch {
      setError('Kunne ikke gemme delingen')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="ue-modal-backdrop fixed inset-0 z-[2000] flex items-end md:items-center justify-center bg-black/60" onClick={onClose}>
      <div
        className="ue-modal-panel w-full md:max-w-md bg-void-900 md:rounded-2xl rounded-t-2xl border border-void-700 max-h-[85vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-void-700 sticky top-0 bg-void-900 z-10">
          <h2 className="font-semibold text-gray-100">👥 Del med bruger</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-200 text-2xl leading-none px-1">×</button>
        </div>

        <div className="p-5 space-y-4">
          <p className="text-xs text-gray-500">
            Vælg en bruger og hvad der deles. Delte pins vises på brugerens kort og under
            &quot;Mine pins&quot;, og de kan selv slå visningen til og fra i kortets filterpanel.{' '}
            <strong className="text-gray-400">Se</strong>: kan kun kigge.{' '}
            <strong className="text-gray-400">Rediger</strong>: kan redigere delte pins og tilføje pins i delte kategorier.
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
                const isExpanded = expandedUserId === user.id
                const current = shares[user.id]
                const isSharing = !!current && (current.categoryIds.length > 0 || current.uncategorized)
                return (
                  <div key={user.id} className="border border-void-700 rounded-xl overflow-hidden">
                    <button
                      type="button"
                      onClick={() => openUser(user.id)}
                      className="w-full flex items-center justify-between gap-3 p-3 text-left hover:bg-void-800/60 transition-colors"
                      aria-expanded={isExpanded}
                    >
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-gray-200 truncate">{user.firstName}</p>
                        <p className={`text-xs truncate ${isSharing ? 'text-rust-500' : 'text-gray-500'}`}>
                          {shareSummary(current, categories.length)}
                          {savedUserId === user.id ? ' · gemt ✓' : ''}
                        </p>
                      </div>
                      <span className="text-gray-500 shrink-0" aria-hidden="true">{isExpanded ? '▾' : '▸'}</span>
                    </button>

                    {isExpanded && (
                      <div className="border-t border-void-700 p-3 space-y-3">
                        <div>
                          <div className="flex items-center justify-between gap-2 mb-1.5">
                            <p className="text-xs text-gray-400">Hvad deles</p>
                            <button
                              type="button"
                              onClick={toggleAll}
                              className="text-[11px] font-medium text-rust-500 hover:text-rust-400 transition-colors"
                            >
                              {allSelected ? 'Fravælg alt' : 'Vælg alt'}
                            </button>
                          </div>
                          <div className="space-y-1.5">
                            {categories.map(cat => (
                              <label key={cat.id} className="flex items-center gap-2.5 text-sm text-gray-300 cursor-pointer">
                                <input
                                  type="checkbox"
                                  checked={draft.categoryIds.includes(cat.id)}
                                  onChange={() => toggleCategory(cat.id)}
                                  className="accent-rust-600"
                                />
                                <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: cat.color }} />
                                <span className="truncate">{cat.name}</span>
                              </label>
                            ))}
                            <label className="flex items-center gap-2.5 text-sm text-gray-300 cursor-pointer">
                              <input
                                type="checkbox"
                                checked={draft.uncategorized}
                                onChange={() => setDraft(prev => ({ ...prev, uncategorized: !prev.uncategorized }))}
                                className="accent-rust-600"
                              />
                              <span className="w-2.5 h-2.5 rounded-full shrink-0 bg-void-500" />
                              <span>Pins uden kategori</span>
                            </label>
                          </div>
                        </div>

                        <div>
                          <p className="text-xs text-gray-400 mb-1.5">Rettighed</p>
                          <div className="flex gap-1.5">
                            {[{ edit: false, label: '👁️ Kan se' }, { edit: true, label: '✏️ Kan redigere' }].map(option => (
                              <button
                                key={String(option.edit)}
                                type="button"
                                onClick={() => setDraft(prev => ({ ...prev, canEdit: option.edit }))}
                                className={`flex-1 px-2 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                                  draft.canEdit === option.edit
                                    ? 'border-rust-600 bg-rust-600/15 text-rust-500'
                                    : 'border-void-600 text-gray-400 hover:bg-void-800'
                                }`}
                              >
                                {option.label}
                              </button>
                            ))}
                          </div>
                        </div>

                        <div className="flex gap-2 pt-1">
                          {isSharing && (
                            <button
                              type="button"
                              onClick={() => saveShare(user.id, { ...EMPTY_SHARE, categoryIds: [] })}
                              disabled={saving}
                              className="btn-secondary flex-1 text-xs !py-2"
                            >
                              Stop deling
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => saveShare(user.id, draft)}
                            disabled={saving || (draft.categoryIds.length === 0 && !draft.uncategorized && !isSharing)}
                            className="btn-primary flex-1 text-xs !py-2"
                          >
                            {saving ? 'Gemmer...' : 'Gem deling'}
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}

          {error && <p className="text-sm text-red-400 bg-red-900/20 border border-red-800/40 rounded-lg px-3 py-2">{error}</p>}

          <p className="text-[11px] text-gray-600">
            Der deles kun pins og kategorier - ikke dine delte links, profil eller indstillinger.
          </p>
        </div>
      </div>
    </div>
  )
}
