'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import type { Category, Pin, PinStatus } from '@/types/pin'
import { PIN_STATUSES, PIN_STATUS_LABELS, PIN_STATUS_COLORS } from '@/types/pin'
import PinModal from './PinModal'
import StarRating from './StarRating'

const NO_CATEGORY = '__none__'
const THUMBNAIL_ZOOM = 18

function isVideoMedia(media: { originalName: string; mimeType?: string }): boolean {
  return media.mimeType?.startsWith('video/') === true || /\.(mp4|m4v|mov|webm|mkv|avi|3gp)$/i.test(media.originalName)
}

function sharedUncatKey(ownerId: string): string {
  return `__shared_none__:${ownerId}`
}

function pinCategoryKey(pin: Pin): string {
  if (pin.category) return pin.category.id
  return pin.ownerId ? sharedUncatKey(pin.ownerId) : NO_CATEGORY
}

function latLngToTile(lat: number, lng: number, zoom: number): { x: number; y: number; z: number } {
  const n = 2 ** zoom
  const x = Math.floor(((lng + 180) / 360) * n)
  const latRad = (lat * Math.PI) / 180
  const y = Math.floor(((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n)
  return { x, y, z: zoom }
}

function tileThumbnailUrl(pin: Pin, maptilerKey: string | null): string | null {
  if (!maptilerKey) return null
  const { x, y, z } = latLngToTile(pin.latitude, pin.longitude, THUMBNAIL_ZOOM)
  return `https://api.maptiler.com/maps/satellite-v4/256/${z}/${x}/${y}.jpg?key=${maptilerKey}`
}

export default function PinsList({
  initialPins,
  categories,
  maptilerKey,
  readOnly,
  kortHref = '/dashboard/kort',
}: {
  initialPins: Pin[]
  categories: Category[]
  maptilerKey: string | null
  readOnly?: boolean
  kortHref?: string
}) {
  const [pins, setPins] = useState(initialPins)
  const [editingPin, setEditingPin] = useState<Pin | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [activeCategoryIds, setActiveCategoryIds] = useState<Set<string>>(
    () => new Set([
      ...categories.map(c => c.id),
      NO_CATEGORY,
      ...initialPins.filter(p => p.ownerId && !p.category).map(p => sharedUncatKey(p.ownerId!)),
    ])
  )
  const ownCategories = categories.filter(c => !c.sharedBy)
  const sharedCategories = categories.filter(c => c.sharedBy)
  const sharedUncatOwners = useMemo(() => {
    const owners = new Map<string, string>()
    for (const pin of pins) {
      if (pin.ownerId && pin.ownerName && !pin.category) owners.set(pin.ownerId, pin.ownerName)
    }
    return Array.from(owners, ([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name, 'da'))
  }, [pins])
  const sharedFilterKeys = [
    ...sharedCategories.map(c => c.id),
    ...sharedUncatOwners.map(owner => sharedUncatKey(owner.id)),
  ]
  const allSharedActive = sharedFilterKeys.length > 0 && sharedFilterKeys.every(key => activeCategoryIds.has(key))

  function toggleAllShared() {
    setActiveCategoryIds(prev => {
      const next = new Set(prev)
      if (allSharedActive) {
        sharedFilterKeys.forEach(key => next.delete(key))
      } else {
        sharedFilterKeys.forEach(key => next.add(key))
      }
      return next
    })
  }
  const [activeStatuses, setActiveStatuses] = useState<Set<PinStatus>>(() => new Set(PIN_STATUSES))
  const [activeRatings, setActiveRatings] = useState<Set<number>>(() => new Set([0, 1, 2, 3]))
  const [collapsedGroupIds, setCollapsedGroupIds] = useState<Set<string>>(() => new Set())

  function toggleCategory(id: string) {
    setActiveCategoryIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  function toggleStatus(s: PinStatus) {
    setActiveStatuses(prev => {
      const next = new Set(prev)
      if (next.has(s)) next.delete(s); else next.add(s)
      return next
    })
  }

  function toggleRating(r: number) {
    setActiveRatings(prev => {
      const next = new Set(prev)
      if (next.has(r)) next.delete(r); else next.add(r)
      return next
    })
  }

  function toggleGroupCollapsed(id: string) {
    setCollapsedGroupIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  async function handleDelete(pin: Pin) {
    if (!confirm('Slet denne pin og alle tilknyttede billeder og videoer?')) return
    setDeletingId(pin.id)
    try {
      const res = await fetch(`/api/pins/${pin.id}`, { method: 'DELETE' })
      if (res.ok) setPins(prev => prev.filter(p => p.id !== pin.id))
    } finally {
      setDeletingId(null)
    }
  }

  const filteredPins = useMemo(
    () =>
      pins.filter(pin => {
        const catKey = pinCategoryKey(pin)
        return activeCategoryIds.has(catKey) && activeStatuses.has(pin.status) && activeRatings.has(pin.rating)
      }),
    [pins, activeCategoryIds, activeStatuses, activeRatings]
  )

  const groups = useMemo(() => {
    const map = new Map<string, { id: string; category: Category | null; ownerName?: string; pins: Pin[] }>()
    for (const pin of filteredPins) {
      const key = pinCategoryKey(pin)
      if (!map.has(key)) map.set(key, { id: key, category: pin.category, ownerName: pin.ownerName, pins: [] })
      map.get(key)!.pins.push(pin)
    }
    return Array.from(map.values()).sort((a, b) => {
      if (!a.category && !b.category) return (a.ownerName ?? '').localeCompare(b.ownerName ?? '', 'da')
      if (!a.category) return 1
      if (!b.category) return -1
      return a.category.name.localeCompare(b.category.name, 'da')
    })
  }, [filteredPins])

  if (pins.length === 0) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-16 text-center text-gray-500">
        <p className="text-4xl mb-3">📍</p>
        <p className="font-medium text-gray-300">Ingen pins endnu</p>
        <p className="text-sm mt-1">Tryk på kortet for at gemme dit første sted.</p>
      </div>
    )
  }

  return (
    <div className="max-w-3xl mx-auto px-4 py-6 space-y-6">
      <div className="card !p-4 space-y-3">
        {categories.length > 0 && (
          <div>
            <p className="text-xs text-gray-500 mb-2">Kategorier</p>
            <div className="flex flex-wrap gap-1.5">
              {ownCategories.map(cat => (
                <button
                  key={cat.id}
                  onClick={() => toggleCategory(cat.id)}
                  className={`text-xs font-medium px-3 py-1.5 rounded-full border transition-colors ${
                    activeCategoryIds.has(cat.id) ? 'text-white' : 'text-gray-500 border-void-600 opacity-50'
                  }`}
                  style={activeCategoryIds.has(cat.id) ? { backgroundColor: cat.color, borderColor: cat.color } : undefined}
                >
                  {cat.name}
                </button>
              ))}
              <button
                onClick={() => toggleCategory(NO_CATEGORY)}
                className={`text-xs font-medium px-3 py-1.5 rounded-full border transition-colors ${
                  activeCategoryIds.has(NO_CATEGORY) ? 'bg-void-700 text-gray-200 border-void-600' : 'text-gray-500 border-void-600 opacity-50'
                }`}
              >
                Ingen kategori
              </button>
            </div>
          </div>
        )}
        {sharedFilterKeys.length > 0 && (
          <div>
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs text-gray-500">Delt med dig</p>
              <button
                onClick={toggleAllShared}
                className="text-[11px] font-medium text-rust-500 hover:text-rust-400 transition-colors"
              >
                {allSharedActive ? 'Skjul alle delte' : 'Vis alle delte'}
              </button>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {sharedCategories.map(cat => (
                <button
                  key={cat.id}
                  onClick={() => toggleCategory(cat.id)}
                  className={`text-xs font-medium px-3 py-1.5 rounded-full border transition-colors ${
                    activeCategoryIds.has(cat.id) ? 'text-white' : 'text-gray-500 border-void-600 opacity-50'
                  }`}
                  style={activeCategoryIds.has(cat.id) ? { backgroundColor: cat.color, borderColor: cat.color } : undefined}
                >
                  {cat.name} · {cat.sharedBy}
                </button>
              ))}
              {sharedUncatOwners.map(owner => {
                const key = sharedUncatKey(owner.id)
                return (
                  <button
                    key={key}
                    onClick={() => toggleCategory(key)}
                    className={`text-xs font-medium px-3 py-1.5 rounded-full border transition-colors ${
                      activeCategoryIds.has(key)
                        ? 'bg-void-700 text-gray-200 border-void-600'
                        : 'text-gray-500 border-void-600 opacity-50'
                    }`}
                  >
                    Uden kategori · {owner.name}
                  </button>
                )
              })}
            </div>
          </div>
        )}
        <div>
          <p className="text-xs text-gray-500 mb-2">Mærke</p>
          <div className="flex flex-wrap gap-1.5">
            {PIN_STATUSES.map(s => (
              <button
                key={s}
                onClick={() => toggleStatus(s)}
                className={`text-xs font-medium px-3 py-1.5 rounded-full border transition-colors ${
                  activeStatuses.has(s) ? 'text-white' : 'text-gray-500 border-void-600 opacity-50'
                }`}
                style={activeStatuses.has(s) ? { backgroundColor: PIN_STATUS_COLORS[s], borderColor: PIN_STATUS_COLORS[s] } : undefined}
              >
                {PIN_STATUS_LABELS[s]}
              </button>
            ))}
          </div>
        </div>
        <div>
          <p className="text-xs text-gray-500 mb-2">Rating</p>
          <div className="flex flex-wrap gap-1.5">
            <button
              onClick={() => toggleRating(0)}
              className={`text-xs font-medium px-3 py-1.5 rounded-full border transition-colors ${
                activeRatings.has(0) ? 'bg-void-700 text-gray-200 border-void-600' : 'text-gray-500 border-void-600 opacity-50'
              }`}
            >
              Ingen rating
            </button>
            {[1, 2, 3].map(r => (
              <button
                key={r}
                onClick={() => toggleRating(r)}
                className={`text-xs font-medium px-3 py-1.5 rounded-full border transition-colors ${
                  activeRatings.has(r) ? 'bg-rust-600 text-white border-rust-600' : 'text-gray-500 border-void-600 opacity-50'
                }`}
              >
                {'★'.repeat(r)}
              </button>
            ))}
          </div>
        </div>
      </div>

      {filteredPins.length === 0 ? (
        <p className="text-sm text-gray-500 text-center py-10">Ingen pins matcher de valgte filtre.</p>
      ) : (
        groups.map(group => {
          const groupId = group.id
          const isCollapsed = collapsedGroupIds.has(groupId)

          return (
          <div key={groupId} className="card !p-0 overflow-hidden">
            <button
              type="button"
              onClick={() => toggleGroupCollapsed(groupId)}
              className="w-full flex items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-void-800/60"
              aria-expanded={!isCollapsed}
            >
              <span
                className={`w-8 h-8 rounded-full shrink-0 flex items-center justify-center text-sm font-semibold ${group.category ? 'text-white' : 'bg-void-700 text-gray-300'}`}
                style={group.category ? { backgroundColor: group.category.color } : undefined}
              >
                {group.category ? group.category.name.charAt(0).toUpperCase() : '—'}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold text-gray-200 truncate">
                  {group.category?.name ?? (group.ownerName ? `Uden kategori · ${group.ownerName}` : 'Ingen kategori')}
                </span>
                <span className="block text-xs text-gray-500">
                  {group.pins.length} {group.pins.length === 1 ? 'pin' : 'pins'}
                  {(() => {
                    const meta = group.category ? categories.find(c => c.id === group.category!.id) : undefined
                    if (meta?.sharedBy) return ` · delt af ${meta.sharedBy}`
                    return group.ownerName ? ` · delt af ${group.ownerName}` : ''
                  })()}
                </span>
              </span>
              <span className="text-lg leading-none text-gray-500" aria-hidden="true">
                {isCollapsed ? '+' : '-'}
              </span>
            </button>

            {!isCollapsed && group.pins.map(pin => {
              const mapUrl = tileThumbnailUrl(pin, maptilerKey)
              return (
                <div key={pin.id} className="flex gap-4 px-4 py-3 border-t border-void-700">
                  {mapUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={mapUrl}
                      alt="Kortudsnit"
                      className="w-28 h-28 rounded-xl object-cover border border-void-700 shrink-0"
                    />
                  ) : (
                    <div className="w-28 h-28 rounded-xl bg-void-800 border border-void-700 shrink-0 flex items-center justify-center text-2xl">
                      {pin.icon || '📍'}
                    </div>
                  )}

                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="font-medium text-gray-100 truncate">{pin.name}</p>
                        <p className="font-mono text-xs text-gray-500">
                          {pin.latitude.toFixed(6)}, {pin.longitude.toFixed(6)}
                        </p>
                        {pin.description && (
                          <p className="mt-1 text-xs text-gray-400 line-clamp-2">{pin.description}</p>
                        )}
                        <div className="mt-1.5 flex items-center gap-2 flex-wrap">
                          <StarRating value={pin.rating} onChange={() => {}} readOnly />
                          <span
                            className="text-[10px] font-medium px-2 py-0.5 rounded-full text-white"
                            style={{ backgroundColor: PIN_STATUS_COLORS[pin.status] }}
                          >
                            {PIN_STATUS_LABELS[pin.status]}
                          </span>
                          {pin.ownerName && (
                            <span className="text-[10px] font-medium px-2 py-0.5 rounded-full text-gray-300 bg-void-700 border border-void-600">
                              👥 {pin.ownerName}
                            </span>
                          )}
                        </div>
                      </div>
                      {pin.images.length > 0 && (
                        <div className="flex -space-x-2 shrink-0">
                          {pin.images.slice(0, 3).map(img => isVideoMedia(img) ? (
                            <div key={img.id} className="relative w-8 h-8 rounded-lg overflow-hidden border-2 border-void-900 bg-black">
                              <video src={img.url} className="w-full h-full object-cover" muted playsInline preload="metadata" />
                              <span className="absolute inset-0 flex items-center justify-center text-[10px] text-white bg-black/25">▶</span>
                            </div>
                          ) : (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img key={img.id} src={img.url} alt={img.originalName} className="w-8 h-8 rounded-lg object-cover border-2 border-void-900" />
                          ))}
                          {pin.images.length > 3 && (
                            <div className="w-8 h-8 rounded-lg bg-void-800 border-2 border-void-900 flex items-center justify-center text-[10px] text-gray-400">
                              +{pin.images.length - 3}
                            </div>
                          )}
                        </div>
                      )}
                    </div>

                    <div className="flex gap-2 mt-3">
                      <Link href={`${kortHref}?pin=${pin.id}`} className="btn-secondary text-xs flex-1 text-center py-2">
                        🗺️ Vis på kort
                      </Link>
                      {readOnly || pin.canEdit === false ? (
                        <button onClick={() => setEditingPin(pin)} className="btn-secondary text-xs flex-1 py-2">
                          👁️ Detaljer
                        </button>
                      ) : (
                        <>
                          <button onClick={() => setEditingPin(pin)} className="btn-secondary text-xs flex-1 py-2">
                            ✏️ Rediger
                          </button>
                          {!pin.ownerName && (
                            <button
                              onClick={() => handleDelete(pin)}
                              disabled={deletingId === pin.id}
                              className="btn-danger text-xs flex-1 py-2"
                            >
                              {deletingId === pin.id ? '...' : '🗑️ Slet'}
                            </button>
                          )}
                        </>
                      )}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
          )
        })
      )}

      {editingPin && (
        <PinModal
          coords={null}
          pin={editingPin}
          categories={categories}
          onClose={() => setEditingPin(null)}
          onCreated={() => {}}
          onUpdated={updated => {
            setPins(prev => prev.map(p => (p.id === updated.id ? updated : p)))
            setEditingPin(updated)
          }}
          onDeleted={id => {
            setPins(prev => prev.filter(p => p.id !== id))
            setEditingPin(null)
          }}
          readOnly={readOnly || editingPin.canEdit === false}
        />
      )}
    </div>
  )
}
