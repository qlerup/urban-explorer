'use client'

import { useState } from 'react'
import type { FormEvent } from 'react'
import type { Category } from '@/types/pin'
import CategoryShareModal from './CategoryShareModal'

const COLOR_OPTIONS = ['#e08a3c', '#3b82f6', '#22c55e', '#ef4444', '#a855f7', '#eab308', '#06b6d4', '#ec4899']

export default function CategoriesManager({
  initialCategories,
  initialShared = [],
}: {
  initialCategories: Category[]
  initialShared?: Category[]
}) {
  const [categories, setCategories] = useState(initialCategories)
  const [sharingCategory, setSharingCategory] = useState<Category | null>(null)
  const [name, setName] = useState('')
  const [color, setColor] = useState(COLOR_OPTIONS[0])
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [expandedCategoryIds, setExpandedCategoryIds] = useState<Set<string>>(() => new Set())
  const [deletingId, setDeletingId] = useState<string | null>(null)

  async function handleCreate(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (!name.trim()) return
    setCreating(true)
    setError(null)
    try {
      const res = await fetch('/api/categories', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), color }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error || 'Kunne ikke oprette kategori')
        return
      }
      setCategories(prev => [...prev, data.category].sort((a, b) => a.name.localeCompare(b.name, 'da')))
      setExpandedCategoryIds(prev => new Set(prev).add(data.category.id))
      setName('')
    } finally {
      setCreating(false)
    }
  }

  function toggleExpanded(id: string) {
    setExpandedCategoryIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  async function handleColorChange(id: string, newColor: string) {
    const res = await fetch(`/api/categories/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ color: newColor }),
    })
    if (res.ok) {
      setCategories(prev => prev.map(c => (c.id === id ? { ...c, color: newColor } : c)))
    }
  }

  async function handleDelete(id: string) {
    if (!confirm('Slet kategorien? Pins i kategorien mister blot deres kategori - de bliver ikke slettet.')) return
    setDeletingId(id)
    try {
      const res = await fetch(`/api/categories/${id}`, { method: 'DELETE' })
      if (res.ok) setCategories(prev => prev.filter(c => c.id !== id))
    } finally {
      setDeletingId(null)
    }
  }

  return (
    <div className="space-y-6">
      <form onSubmit={handleCreate} className="card space-y-3">
        <label className="block text-sm font-medium text-gray-300">Ny kategori</label>
        <div className="flex gap-2">
          <input
            className="input"
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder='Fx "Sjælland"'
            maxLength={60}
          />
          <button type="submit" disabled={creating || !name.trim()} className="btn-primary w-auto px-5 shrink-0">
            {creating ? '...' : 'Opret'}
          </button>
        </div>
        <div>
          <p className="text-xs text-gray-500 mb-1.5">Farve</p>
          <div className="flex gap-2 flex-wrap">
            {COLOR_OPTIONS.map(c => (
              <button
                key={c}
                type="button"
                onClick={() => setColor(c)}
                className={`w-7 h-7 rounded-full border-2 transition-transform ${color === c ? 'border-white scale-110' : 'border-transparent'}`}
                style={{ backgroundColor: c }}
                aria-label={`Vælg farve ${c}`}
              />
            ))}
          </div>
        </div>
        {error && <p className="text-sm text-red-400 bg-red-900/20 border border-red-800/40 rounded-lg px-3 py-2">{error}</p>}
      </form>

      {categories.length === 0 ? (
        <p className="text-sm text-gray-500 text-center py-8">Ingen kategorier endnu.</p>
      ) : (
        <div className="space-y-2">
          {categories.map(cat => {
            const isExpanded = expandedCategoryIds.has(cat.id)
            return (
              <div key={cat.id} className="card !p-0 overflow-hidden">
                <div className="flex items-center gap-2 p-3">
                  <button
                    type="button"
                    onClick={() => toggleExpanded(cat.id)}
                    className="min-w-0 flex-1 flex items-center gap-3 rounded-xl px-1 py-1 text-left transition-colors hover:bg-void-800/60"
                    aria-expanded={isExpanded}
                    aria-label={`${isExpanded ? 'Fold ind' : 'Fold ud'} ${cat.name}`}
                  >
                    <span
                      className="w-9 h-9 rounded-lg flex items-center justify-center text-sm font-semibold text-white shrink-0 border border-void-600"
                      style={{ backgroundColor: cat.color }}
                    >
                      {cat.name.charAt(0).toUpperCase()}
                    </span>
                    <span className="min-w-0 flex-1 flex items-center gap-2">
                      <span className="text-sm font-medium text-gray-200 truncate">{cat.name}</span>
                      {(cat.shareCount ?? 0) > 0 && (
                        <span className="text-[10px] font-medium text-rust-500 bg-rust-600/15 border border-rust-600/40 rounded-full px-1.5 py-0.5 shrink-0">
                          👥 {cat.shareCount}
                        </span>
                      )}
                    </span>
                    <span className="text-gray-500 transition-transform" aria-hidden="true">
                      {isExpanded ? '▾' : '▸'}
                    </span>
                  </button>

                  <button
                    onClick={() => handleDelete(cat.id)}
                    disabled={deletingId === cat.id}
                    className="text-gray-500 hover:text-red-400 transition-colors p-1.5 shrink-0"
                    aria-label="Slet kategori"
                  >
                    🗑️
                  </button>
                </div>

                {isExpanded && (
                  <div className="space-y-4 border-t border-void-700 px-3 pb-3 pt-3">
                    <div>
                      <p className="text-xs text-gray-500 mb-1.5">Farve</p>
                      <div className="flex gap-2 flex-wrap">
                        {COLOR_OPTIONS.map(c => (
                          <button
                            key={c}
                            type="button"
                            onClick={() => handleColorChange(cat.id, c)}
                            className={`w-7 h-7 rounded-full border-2 transition-transform ${
                              cat.color === c ? 'border-white scale-110' : 'border-transparent'
                            }`}
                            style={{ backgroundColor: c }}
                            aria-label={`Vælg farve ${c}`}
                          />
                        ))}
                      </div>
                    </div>
                    <div>
                      <p className="text-xs text-gray-500 mb-1.5">Deling</p>
                      <button
                        type="button"
                        onClick={() => setSharingCategory(cat)}
                        className="btn-secondary text-xs py-2 px-3"
                      >
                        👥 {(cat.shareCount ?? 0) > 0
                          ? `Delt med ${cat.shareCount} ${cat.shareCount === 1 ? 'bruger' : 'brugere'} - administrér`
                          : 'Del med andre brugere'}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {initialShared.length > 0 && (
        <div>
          <h2 className="text-sm font-semibold text-gray-300 mb-1">Delt med dig</h2>
          <p className="text-xs text-gray-500 mb-3">Kategorier andre brugere har delt med dig</p>
          <div className="space-y-2">
            {initialShared.map(cat => (
              <div key={cat.id} className="card !p-3 flex items-center gap-3">
                <span
                  className="w-9 h-9 rounded-lg flex items-center justify-center text-sm font-semibold text-white shrink-0 border border-void-600"
                  style={{ backgroundColor: cat.color }}
                >
                  {cat.name.charAt(0).toUpperCase()}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-gray-200 truncate">{cat.name}</p>
                  <p className="text-xs text-gray-500 truncate">Delt af {cat.sharedBy}</p>
                </div>
                <span
                  className={`text-[10px] font-medium rounded-full px-2 py-0.5 shrink-0 border ${
                    cat.canEdit
                      ? 'text-rust-500 bg-rust-600/15 border-rust-600/40'
                      : 'text-gray-400 bg-void-800 border-void-600'
                  }`}
                >
                  {cat.canEdit ? '✏️ Kan redigere' : '👁️ Kan se'}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {sharingCategory && (
        <CategoryShareModal
          category={sharingCategory}
          onClose={() => setSharingCategory(null)}
          onSaved={shareCount => {
            setCategories(prev => prev.map(c => (c.id === sharingCategory.id ? { ...c, shareCount } : c)))
            setSharingCategory(null)
          }}
        />
      )}
    </div>
  )
}
