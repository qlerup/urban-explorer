'use client'

import { useState } from 'react'
import type { Category, Pin } from '@/types/pin'
import SharePickerModal from './SharePickerModal'

interface ShareLink {
  id: string
  token: string
  label: string
  pinCount: number
  pinIds: string[]
  createdAt: string
}

export default function ShareLinksManager({
  initialShares,
  origin,
  pins,
  categories,
}: {
  initialShares: ShareLink[]
  origin: string
  pins: Pin[]
  categories: Category[]
}) {
  const [shares, setShares] = useState(initialShares)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [editingShare, setEditingShare] = useState<ShareLink | null>(null)

  async function handleDelete(id: string) {
    if (!confirm('Slet dette delte link? Alle der har linket mister adgangen med det samme.')) return
    setDeletingId(id)
    try {
      const res = await fetch(`/api/shares/${id}`, { method: 'DELETE' })
      if (res.ok) setShares(prev => prev.filter(s => s.id !== id))
    } finally {
      setDeletingId(null)
    }
  }

  function copyLink(id: string, url: string) {
    navigator.clipboard.writeText(url).then(() => {
      setCopiedId(id)
      setTimeout(() => setCopiedId(prev => (prev === id ? null : prev)), 2000)
    })
  }

  function handleSaved(updatedShare: ShareLink) {
    setShares(prev => prev.map(share => (share.id === updatedShare.id ? updatedShare : share)))
  }

  if (shares.length === 0) {
    return (
      <p className="text-sm text-gray-500 text-center py-8">
        Ingen delte links endnu. Opret et fra kortet via "Del pins".
      </p>
    )
  }

  return (
    <>
      <div className="space-y-2">
        {shares.map(share => {
          const url = `${origin}/share/${share.token}`
          return (
            <div key={share.id} className="card !p-3 space-y-2">
              <div className="flex items-center gap-3">
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-gray-200 truncate">{share.label || 'Unavngivet link'}</p>
                  <p className="text-xs text-gray-500">
                    {share.pinCount} {share.pinCount === 1 ? 'pin' : 'pins'} · Oprettet{' '}
                    {new Date(share.createdAt).toLocaleDateString('da-DK', { day: 'numeric', month: 'short', year: 'numeric' })}
                  </p>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <button
                    onClick={() => setEditingShare(share)}
                    className="btn-secondary w-auto px-3 py-1.5 text-xs"
                  >
                    Rediger
                  </button>
                  <button
                    onClick={() => handleDelete(share.id)}
                    disabled={deletingId === share.id}
                    className="text-gray-500 hover:text-red-400 transition-colors p-1.5"
                    aria-label="Slet link"
                  >
                    🗑️
                  </button>
                </div>
              </div>
              <div className="flex gap-2">
                <input readOnly className="input font-mono text-xs" value={url} onFocus={e => e.target.select()} />
                <button onClick={() => copyLink(share.id, url)} className="btn-secondary w-auto px-4 shrink-0 text-sm">
                  {copiedId === share.id ? 'Kopieret!' : 'Kopiér'}
                </button>
              </div>
            </div>
          )
        })}
      </div>

      {editingShare && (
        <SharePickerModal
          pins={pins}
          categories={categories}
          share={editingShare}
          origin={origin}
          onSaved={handleSaved}
          onClose={() => setEditingShare(null)}
        />
      )}
    </>
  )
}
