'use client'

import { useMemo, useState } from 'react'
import type { Category, Pin } from '@/types/pin'

interface ShareLink {
  id: string
  token: string
  label: string
  pinCount: number
  pinIds: string[]
  createdAt: string
}

interface EditableShareLink {
  id: string
  label: string
  pinIds: string[]
}

const NO_CATEGORY = '__none__'

export default function SharePickerModal({
  pins,
  onClose,
  share,
  origin,
  onSaved,
}: {
  pins: Pin[]
  categories: Category[]
  onClose: () => void
  share?: EditableShareLink
  origin?: string
  onSaved?: (share: ShareLink) => void
}) {
  const isEditing = Boolean(share)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set(share?.pinIds ?? []))
  const [label, setLabel] = useState(share?.label ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [createdUrl, setCreatedUrl] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  const groups = useMemo(() => {
    const map = new Map<string, { category: Category | null; pins: Pin[] }>()
    for (const pin of pins) {
      const key = pin.category?.id ?? NO_CATEGORY
      if (!map.has(key)) map.set(key, { category: pin.category, pins: [] })
      map.get(key)!.pins.push(pin)
    }
    return Array.from(map.values()).sort((a, b) => {
      if (!a.category) return 1
      if (!b.category) return -1
      return a.category.name.localeCompare(b.category.name, 'da')
    })
  }, [pins])

  function togglePin(id: string) {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  function toggleGroup(groupPins: Pin[]) {
    const allSelected = groupPins.every(p => selectedIds.has(p.id))
    setSelectedIds(prev => {
      const next = new Set(prev)
      for (const p of groupPins) {
        if (allSelected) next.delete(p.id); else next.add(p.id)
      }
      return next
    })
  }

  async function handleSave() {
    setSaving(true)
    setError(null)
    try {
      const res = await fetch(share ? `/api/shares/${share.id}` : '/api/shares', {
        method: share ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label: label.trim(), pinIds: Array.from(selectedIds) }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error || (share ? 'Kunne ikke gemme link' : 'Kunne ikke oprette link'))
        return
      }
      if (share) {
        onSaved?.(data.share)
        onClose()
        return
      }
      setCreatedUrl(`${origin ?? window.location.origin}/share/${data.share.token}`)
    } finally {
      setSaving(false)
    }
  }

  function copyLink() {
    if (!createdUrl) return
    navigator.clipboard.writeText(createdUrl).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  return (
    <div className="fixed inset-0 z-[2000] flex items-end md:items-center justify-center bg-black/60" onClick={onClose}>
      <div
        className="w-full md:max-w-md bg-void-900 md:rounded-2xl rounded-t-2xl border border-void-700 max-h-[85vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-void-700 sticky top-0 bg-void-900">
          <h2 className="font-semibold text-gray-100">{isEditing ? 'Rediger link' : 'Del pins'}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-200 text-2xl leading-none px-1">×</button>
        </div>

        {createdUrl ? (
          <div className="p-5 space-y-3">
            <p className="text-sm text-gray-300">Linket er oprettet:</p>
            <div className="flex gap-2">
              <input readOnly className="input font-mono text-xs" value={createdUrl} onFocus={e => e.target.select()} />
              <button onClick={copyLink} className="btn-secondary w-auto px-4 shrink-0 text-sm">
                {copied ? 'Kopieret!' : 'Kopiér'}
              </button>
            </div>
            <button onClick={onClose} className="btn-primary w-full">Luk</button>
          </div>
        ) : (
          <div className="p-5 space-y-4">
            <p className="text-xs text-gray-500">
              Vælg de pins eller hele kategorier du vil dele. Modtageren kan kun se det du vælger her — ikke redigere.
            </p>

            {pins.length === 0 ? (
              <p className="text-sm text-gray-500 text-center py-6">Ingen pins at dele endnu.</p>
            ) : (
              <div className="space-y-4 max-h-[45vh] overflow-y-auto pr-1">
                {groups.map(group => {
                  const key = group.category?.id ?? NO_CATEGORY
                  const allSelected = group.pins.every(p => selectedIds.has(p.id))
                  const someSelected = !allSelected && group.pins.some(p => selectedIds.has(p.id))
                  return (
                    <div key={key}>
                      <label className="flex items-center gap-2 mb-1.5 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={allSelected}
                          ref={el => { if (el) el.indeterminate = someSelected }}
                          onChange={() => toggleGroup(group.pins)}
                          className="w-4 h-4 accent-rust-600"
                        />
                        {group.category && (
                          <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: group.category.color }} />
                        )}
                        <span className="text-sm font-semibold text-gray-300">{group.category?.name ?? 'Ingen kategori'}</span>
                        <span className="text-xs text-gray-600">{group.pins.length}</span>
                      </label>
                      <div className="pl-6 space-y-1">
                        {group.pins.map(pin => (
                          <label key={pin.id} className="flex items-center gap-2 cursor-pointer py-0.5">
                            <input
                              type="checkbox"
                              checked={selectedIds.has(pin.id)}
                              onChange={() => togglePin(pin.id)}
                              className="w-4 h-4 accent-rust-600"
                            />
                            <span className="text-sm text-gray-300 truncate">{pin.name || 'Uden navn'}</span>
                          </label>
                        ))}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}

            <div>
              <label htmlFor="share-label-input" className="text-xs text-gray-500 mb-1 block">Navngiv linket (valgfrit)</label>
              <input
                id="share-label-input"
                className="input"
                value={label}
                onChange={e => setLabel(e.target.value)}
                placeholder="Fx &quot;Til Peter&quot;"
                maxLength={100}
              />
            </div>

            {error && <p className="text-sm text-red-400 bg-red-900/20 border border-red-800/40 rounded-lg px-3 py-2">{error}</p>}

            <button onClick={handleSave} disabled={saving || selectedIds.size === 0} className="btn-primary w-full">
              {saving
                ? isEditing ? 'Gemmer...' : 'Opretter...'
                : `${isEditing ? 'Gem ændringer' : 'Opret delt link'}${selectedIds.size > 0 ? ` (${selectedIds.size})` : ''}`}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
