'use client'

import { useEffect, useRef, useState } from 'react'
import type { Category, Pin, PinImage, PinRoute, PinStatus } from '@/types/pin'
import { PIN_STATUSES, PIN_STATUS_LABELS, PIN_STATUS_COLORS, PIN_ICON_OPTIONS } from '@/types/pin'
import { formatDistance } from '@/lib/geo'
import StarRating from './StarRating'

interface Props {
  coords: { lat: number; lng: number } | null
  pin: Pin | null
  categories: Category[]
  onClose: () => void
  onCreated: (pin: Pin) => void
  onUpdated: (pin: Pin) => void
  onDeleted: (pinId: string) => void
  visibleRouteId?: string | null
  onToggleRoute?: (routeId: string) => void
  onEditRoute?: (route: PinRoute) => void
  readOnly?: boolean
  createOwnerId?: string
  allowUncategorized?: boolean
}

interface StagedImage {
  file: File
  previewUrl: string
}

const VIDEO_EXTENSIONS = ['mp4', 'm4v', 'mov', 'webm', 'mkv', 'avi', '3gp']
const MEDIA_EXTENSIONS = ['jpg', 'jpeg', 'png', ...VIDEO_EXTENSIONS]
const IMAGE_ACCEPT = '.jpg,.jpeg,.png,.mp4,.m4v,.mov,.webm,.mkv,.avi,.3gp,image/jpeg,image/png,video/mp4,video/quicktime,video/webm'

function fileExtension(filename: string): string {
  return filename.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] ?? ''
}

function isVideoName(filename: string): boolean {
  return VIDEO_EXTENSIONS.includes(fileExtension(filename))
}

function isVideoMedia(media: { originalName: string; mimeType?: string }): boolean {
  return media.mimeType?.startsWith('video/') === true || isVideoName(media.originalName)
}

function imageFileError(file: File): string | null {
  if (!MEDIA_EXTENSIONS.includes(fileExtension(file.name))) return `${file.name}: Filtypen understøttes ikke.`
  if (file.size <= 0) return `${file.name}: Filen er tom.`
  return null
}

interface ChunkUploadResponse {
  offset?: number
  complete?: boolean
  image?: PinImage
  error?: string
}

function uploadImageChunk(
  url: string,
  chunk: Blob,
  offset: number,
  totalBytes: number,
  onProgress: (percent: number) => void
): Promise<ChunkUploadResponse> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('POST', url)
    xhr.responseType = 'json'
    xhr.setRequestHeader('Content-Type', 'application/octet-stream')
    xhr.setRequestHeader('Upload-Offset', String(offset))
    xhr.upload.onprogress = event => {
      if (event.lengthComputable && totalBytes > 0) {
        onProgress(Math.min(100, Math.round(((offset + event.loaded) / totalBytes) * 100)))
      }
    }
    xhr.onerror = () => reject(new Error('Netværksfejl under upload'))
    xhr.onload = () => {
      const data = xhr.response && typeof xhr.response === 'object'
        ? xhr.response as ChunkUploadResponse
        : {}
      if (xhr.status >= 200 && xhr.status < 300) resolve(data)
      else if (xhr.status === 409 && typeof data.offset === 'number' && data.offset !== offset) resolve(data)
      else reject(new Error(data.error || 'Kunne ikke uploade mediefilen'))
    }
    xhr.send(chunk)
  })
}

async function uploadPinImage(pinId: string, file: File, onProgress: (percent: number) => void): Promise<PinImage> {
  const initResponse = await fetch(`/api/pins/${pinId}/images/uploads`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ filename: file.name, size: file.size }),
  })
  const init = await initResponse.json().catch(() => ({})) as { uploadId?: string; chunkSize?: number; error?: string }
  if (!initResponse.ok || !init.uploadId || !init.chunkSize) {
    throw new Error(init.error || 'Kunne ikke starte upload')
  }

  const uploadUrl = `/api/pins/${pinId}/images/uploads/${init.uploadId}`
  let offset = 0
  let completedImage: PinImage | undefined
  try {
    while (offset < file.size) {
      const chunk = file.slice(offset, Math.min(offset + init.chunkSize, file.size))
      let response: ChunkUploadResponse | null = null
      let lastError: unknown
      for (let attempt = 0; attempt < 4 && !response; attempt += 1) {
        try {
          response = await uploadImageChunk(uploadUrl, chunk, offset, file.size, onProgress)
        } catch (error) {
          lastError = error
          if (attempt < 3) await new Promise(resolve => window.setTimeout(resolve, 500 * (2 ** attempt)))
        }
      }
      if (!response) throw lastError instanceof Error ? lastError : new Error('Kunne ikke uploade billeddelen')
      if (typeof response.offset !== 'number' || response.offset <= offset) {
        throw new Error(response.error || 'Serveren returnerede en ugyldig upload-position')
      }
      offset = response.offset
      if (response.image) completedImage = response.image
      onProgress(Math.min(100, Math.round((offset / file.size) * 100)))
    }
    if (!completedImage) throw new Error('Mediefilen blev uploadet, men serveren returnerede intet resultat')
    return completedImage
  } catch (error) {
    await fetch(uploadUrl, { method: 'DELETE' }).catch(() => {})
    throw error
  }
}

export default function PinModal({ coords, pin, categories, onClose, onCreated, onUpdated, onDeleted, visibleRouteId, onToggleRoute, onEditRoute, readOnly, createOwnerId, allowUncategorized = true }: Props) {
  const [currentPin, setCurrentPin] = useState<Pin | null>(pin)
  const [name, setName] = useState(pin?.name ?? '')
  const [description, setDescription] = useState(pin?.description ?? '')
  const [rating, setRating] = useState(pin?.rating ?? 0)
  const [status, setStatus] = useState<PinStatus>(pin?.status ?? 'vil_se')
  const [icon, setIcon] = useState<string>(pin?.icon ?? PIN_ICON_OPTIONS[0])
  const [categoryId, setCategoryId] = useState<string>(pin?.category?.id ?? '')
  const [stagedImages, setStagedImages] = useState<StagedImage[]>([])
  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [uploadProgress, setUploadProgress] = useState<number | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [deletingRouteId, setDeletingRouteId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const stagedFileInputRef = useRef<HTMLInputElement>(null)

  const isCreateMode = !currentPin
  // Egne kategorier + kategorier delt med redigeringsret kan tildeles pins
  const assignableCategories = categories.filter(c => !c.sharedBy || c.canEdit)
  const isOwnPin = !currentPin?.ownerName
  const lat = currentPin?.latitude ?? coords?.lat ?? 0
  const lng = currentPin?.longitude ?? coords?.lng ?? 0
  const googleMapsUrl = `https://www.google.com/maps/place/${lat},${lng}/@${lat},${lng},18z/data=!3m1!1e3`

  useEffect(() => {
    if (isCreateMode && !allowUncategorized && !categoryId && assignableCategories[0]) {
      setCategoryId(assignableCategories[0].id)
    }
  }, [allowUncategorized, assignableCategories, categoryId, isCreateMode])

  useEffect(() => {
    return () => {
      stagedImages.forEach(s => URL.revokeObjectURL(s.previewUrl))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function handleStageFiles(e: React.ChangeEvent<HTMLInputElement>) {
    if (!e.target.files?.length) return
    const files = Array.from(e.target.files)
    const firstError = files.map(imageFileError).find((message): message is string => !!message)
    if (firstError) setError(firstError)
    const added = files
      .filter(file => !imageFileError(file))
      .map(file => ({ file, previewUrl: URL.createObjectURL(file) }))
    setStagedImages(prev => [...prev, ...added])
    if (stagedFileInputRef.current) stagedFileInputRef.current.value = ''
  }

  async function uploadFiles(pinId: string, files: File[]): Promise<PinImage[]> {
    if (!files.length) return []
    setUploading(true)
    setUploadProgress(0)
    const uploaded: PinImage[] = []
    try {
      for (let index = 0; index < files.length; index += 1) {
        try {
          const image = await uploadPinImage(pinId, files[index], filePercent => {
            setUploadProgress(Math.round(((index + filePercent / 100) / files.length) * 100))
          })
          uploaded.push(image)
          setUploadProgress(Math.round(((index + 1) / files.length) * 100))
        } catch (uploadError) {
          setError(uploadError instanceof Error ? uploadError.message : 'Kunne ikke uploade mediefilen')
        }
      }
      return uploaded
    } finally {
      setUploading(false)
      setUploadProgress(null)
    }
  }

  function removeStagedImage(index: number) {
    setStagedImages(prev => {
      const removed = prev[index]
      if (removed) URL.revokeObjectURL(removed.previewUrl)
      return prev.filter((_, i) => i !== index)
    })
  }

  async function handleSave() {
    if (!name.trim()) {
      setError('Giv pinnen et navn før du gemmer')
      return
    }
    setSaving(true)
    setError(null)
    try {
      const res = await fetch('/api/pins', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), description: description.trim(), latitude: lat, longitude: lng, rating, status, icon, categoryId: categoryId || null, ownerId: createOwnerId || null }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error || 'Kunne ikke gemme pin')
        return
      }

      let savedPin: Pin = data.pin

      if (stagedImages.length > 0) {
        const uploadedImages = await uploadFiles(savedPin.id, stagedImages.map(staged => staged.file))
        savedPin = { ...savedPin, images: uploadedImages }
        stagedImages.forEach(s => URL.revokeObjectURL(s.previewUrl))
        setStagedImages([])
      }

      setCurrentPin(savedPin)
      onCreated(savedPin)
    } catch {
      setError('Kunne ikke gemme pin')
    } finally {
      setSaving(false)
    }
  }

  const isDirty = !!currentPin && (
    name.trim() !== currentPin.name ||
    description.trim() !== currentPin.description ||
    rating !== currentPin.rating ||
    status !== currentPin.status ||
    icon !== currentPin.icon ||
    categoryId !== (currentPin.category?.id ?? '')
  )

  async function handleUpdate() {
    if (!currentPin) return
    const trimmed = name.trim()
    if (!trimmed) {
      setError('Giv pinnen et navn før du gemmer')
      return
    }
    setSaving(true)
    setError(null)
    try {
      const res = await fetch(`/api/pins/${currentPin.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: trimmed, description: description.trim(), rating, status, icon, categoryId: categoryId || null }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error || 'Kunne ikke gemme ændringer')
        return
      }
      const updated = { ...currentPin, name: data.name, description: data.description, rating: data.rating, status: data.status, icon: data.icon, category: data.category }
      setCurrentPin(updated)
      setName(updated.name)
      setDescription(updated.description)
      onUpdated(updated)
    } catch {
      setError('Kunne ikke gemme ændringer')
    } finally {
      setSaving(false)
    }
  }

  function handleClose() {
    if (isDirty && !confirm('Du har ugemte ændringer. Luk uden at gemme?')) return
    onClose()
  }

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    if (!currentPin || !e.target.files?.length) return
    setError(null)
    try {
      const files = Array.from(e.target.files)
      const firstError = files.map(imageFileError).find((message): message is string => !!message)
      if (firstError) setError(firstError)
      const validFiles = files.filter(file => !imageFileError(file))
      const images = await uploadFiles(currentPin.id, validFiles)
      for (const image of images) {
        setCurrentPin(prev => {
          const updated = prev ? { ...prev, images: [...prev.images, image] } : prev
          if (updated) onUpdated(updated)
          return updated
        })
      }
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  async function handleDeleteImage(imageId: string) {
    if (!currentPin) return
    const res = await fetch(`/api/pins/${currentPin.id}/images/${imageId}`, { method: 'DELETE' })
    if (res.ok) {
      const updated = { ...currentPin, images: currentPin.images.filter(i => i.id !== imageId) }
      setCurrentPin(updated)
      onUpdated(updated)
    }
  }

  async function handleDeletePin() {
    if (!currentPin) return
    if (!confirm('Slet denne pin og alle tilknyttede billeder og videoer?')) return
    setDeleting(true)
    try {
      const res = await fetch(`/api/pins/${currentPin.id}`, { method: 'DELETE' })
      if (res.ok) {
        onDeleted(currentPin.id)
        onClose()
      }
    } finally {
      setDeleting(false)
    }
  }

  async function handleDeleteRoute(routeId: string) {
    if (!currentPin) return
    if (!confirm('Slet denne rute?')) return
    setDeletingRouteId(routeId)
    try {
      const res = await fetch(`/api/pins/${currentPin.id}/rute/${routeId}`, { method: 'DELETE' })
      if (res.ok) {
        const updated = { ...currentPin, routes: currentPin.routes.filter(r => r.id !== routeId) }
        setCurrentPin(updated)
        onUpdated(updated)
      }
    } finally {
      setDeletingRouteId(null)
    }
  }

  return (
    <div className="ue-modal-backdrop fixed inset-0 z-[2000] flex items-end md:items-center justify-center bg-black/60" onClick={handleClose}>
      <div
        className="ue-modal-panel w-full md:max-w-sm bg-void-900 md:rounded-2xl rounded-t-2xl border border-void-700 max-h-[85vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-void-700 sticky top-0 bg-void-900">
          <h2 className="font-semibold text-gray-100 truncate">{isCreateMode ? 'Ny pin' : currentPin?.name || 'Pin'}</h2>
          <button onClick={handleClose} className="text-gray-400 hover:text-gray-200 text-2xl leading-none px-1">×</button>
        </div>

        <div className="p-5 space-y-5">
          {currentPin?.ownerName && (
            <p className="text-xs font-medium text-gray-300 bg-void-800 border border-void-600 rounded-lg px-3 py-2">
              👥 Delt af {currentPin.ownerName}
              {readOnly ? ' · du kan kun se denne pin' : ' · du kan redigere denne pin'}
            </p>
          )}
          {!readOnly && (
            <div>
              <label htmlFor="pin-name-input" className="text-xs text-gray-500 mb-1 block">Navn</label>
              <input
                id="pin-name-input"
                type="text"
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder="Fx &quot;Gammel fabrik&quot;"
                maxLength={200}
                className="input"
              />
            </div>
          )}

          {!readOnly ? (
            <div>
              <label htmlFor="pin-description-input" className="text-xs text-gray-500 mb-1 block">Beskrivelse</label>
              <textarea
                id="pin-description-input"
                value={description}
                onChange={e => setDescription(e.target.value)}
                placeholder="Noter, adgang, hvad du vil huske..."
                maxLength={2000}
                rows={4}
                className="input min-h-24 resize-y"
              />
            </div>
          ) : (
            currentPin?.description && (
              <div>
                <p className="text-xs text-gray-500 mb-1">Beskrivelse</p>
                <p className="whitespace-pre-wrap text-sm leading-6 text-gray-200">{currentPin.description}</p>
              </div>
            )
          )}

          <div>
            <p className="text-xs text-gray-500 mb-1">Koordinater</p>
            <p className="font-mono text-sm text-gray-200">{lat.toFixed(6)}, {lng.toFixed(6)}</p>
          </div>

          <a
            href={googleMapsUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="btn-secondary flex items-center justify-center gap-2 text-sm"
          >
            🌍 Åbn i Google Maps
          </a>

          {!isCreateMode && currentPin && (currentPin.routes.length > 0 || !readOnly) && (
            <div>
              <p className="text-xs text-gray-500 mb-2">Ruter</p>
              {currentPin.routes.length > 0 ? (
                <div className="space-y-2">
                  {currentPin.routes.map(route => (
                    <div key={route.id} className="flex items-center gap-2 border border-void-700 rounded-xl px-3 py-2">
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-gray-200 truncate">{route.name || 'Rute'}</p>
                        <p className="text-xs text-gray-500">{formatDistance(route.distanceMeters)}</p>
                      </div>
                      <button
                        type="button"
                        onClick={() => onToggleRoute?.(route.id)}
                        className="btn-secondary text-xs px-3 py-1.5 shrink-0"
                      >
                        📍 {visibleRouteId === route.id ? 'Skjul' : 'Vis'}
                      </button>
                      {!readOnly && (
                        <>
                          <button
                            type="button"
                            onClick={() => onEditRoute?.(route)}
                            className="text-gray-400 hover:text-gray-200 p-1.5 shrink-0"
                            aria-label="Rediger rute"
                          >
                            ✏️
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDeleteRoute(route.id)}
                            disabled={deletingRouteId === route.id}
                            className="text-gray-500 hover:text-red-400 p-1.5 shrink-0"
                            aria-label="Slet rute"
                          >
                            🗑️
                          </button>
                        </>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-gray-500">
                  Ingen ruter gemt endnu. Brug 📍-knappen på kortet for at tegne og gemme en rute hertil.
                </p>
              )}
            </div>
          )}

          <div>
            <p className="text-xs text-gray-500 mb-2">Rating</p>
            <StarRating value={rating} onChange={setRating} readOnly={readOnly} />
          </div>

          <div>
            <p className="text-xs text-gray-500 mb-2">Ikon</p>
            {readOnly ? (
              <span className="w-10 h-10 rounded-lg border border-void-600 flex items-center justify-center text-xl">
                {icon}
              </span>
            ) : (
              <div className="flex gap-1.5 flex-wrap">
                {PIN_ICON_OPTIONS.map(ic => (
                  <button
                    key={ic}
                    type="button"
                    onClick={() => setIcon(ic)}
                    className={`w-9 h-9 rounded-lg border flex items-center justify-center text-lg transition-colors ${
                      icon === ic ? 'border-rust-600 bg-rust-600/15' : 'border-void-600 hover:bg-void-800'
                    }`}
                    aria-label={`Vælg ikon ${ic}`}
                  >
                    {ic}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div>
            <p className="text-xs text-gray-500 mb-2">Mærke</p>
            {readOnly ? (
              <span
                className="text-xs font-medium px-3 py-1.5 rounded-full text-white inline-block"
                style={{ backgroundColor: PIN_STATUS_COLORS[status] }}
              >
                {PIN_STATUS_LABELS[status]}
              </span>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {PIN_STATUSES.map(s => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setStatus(s)}
                    className={`text-xs font-medium px-3 py-1.5 rounded-full border transition-colors ${
                      status === s ? 'text-white' : 'text-gray-400 border-void-600 hover:border-void-500'
                    }`}
                    style={status === s ? { backgroundColor: PIN_STATUS_COLORS[s], borderColor: PIN_STATUS_COLORS[s] } : undefined}
                  >
                    {PIN_STATUS_LABELS[s]}
                  </button>
                ))}
              </div>
            )}
          </div>

          {currentPin?.category && readOnly ? (
            <div>
              <p className="text-xs text-gray-500 mb-2">Kategori</p>
              <span
                className="text-xs font-medium px-3 py-1.5 rounded-full text-white inline-flex items-center gap-1.5"
                style={{ backgroundColor: currentPin.category.color }}
              >
                {currentPin.category.name}
              </span>
            </div>
          ) : (
            !readOnly && assignableCategories.length > 0 && (
              <div>
                <label htmlFor="pin-category-select" className="text-xs text-gray-500 mb-2 block">Kategori</label>
                <select
                  id="pin-category-select"
                  value={categoryId}
                  onChange={e => setCategoryId(e.target.value)}
                  className="input"
                  disabled={!isOwnPin}
                >
                  {allowUncategorized && <option value="">Ingen kategori</option>}
                  {assignableCategories.map(cat => (
                    <option key={cat.id} value={cat.id}>
                      {cat.name}{cat.sharedBy ? ` · delt af ${cat.sharedBy}` : ''}
                    </option>
                  ))}
                </select>
                {!isOwnPin && (
                  <p className="text-xs text-gray-500 mt-1">Kun ejeren kan flytte pinnen til en anden kategori.</p>
                )}
              </div>
            )
          )}

          {isCreateMode && (
            <div>
              <p className="text-xs text-gray-500 mb-2">Billeder og videoer</p>
              {stagedImages.length > 0 && (
                <div className="grid grid-cols-3 gap-2 mb-2">
                  {stagedImages.map((staged, i) => (
                    <div key={staged.previewUrl} className="relative aspect-square rounded-lg overflow-hidden border border-void-700">
                      {isVideoName(staged.file.name) ? (
                        <video src={staged.previewUrl} className="w-full h-full object-cover" controls muted playsInline preload="metadata" />
                      ) : (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={staged.previewUrl} alt={staged.file.name} className="w-full h-full object-cover" />
                      )}
                      <button
                        onClick={() => removeStagedImage(i)}
                        className="absolute top-1 right-1 w-6 h-6 bg-black/70 text-white rounded-full text-xs flex items-center justify-center"
                        aria-label="Fjern mediefil"
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>
              )}
              <input
                ref={stagedFileInputRef}
                type="file"
                accept={IMAGE_ACCEPT}
                multiple
                onChange={handleStageFiles}
                className="hidden"
                id="pin-image-stage-input"
              />
              <label htmlFor="pin-image-stage-input" className="btn-secondary text-sm inline-flex items-center gap-2 cursor-pointer w-full justify-center">
                📷 Tilføj billede eller video
              </label>
            </div>
          )}

          {!isCreateMode && currentPin && readOnly && currentPin.images.length > 0 && (
            <div>
              <p className="text-xs text-gray-500 mb-2">Billeder og videoer</p>
              <div className="grid grid-cols-3 gap-2">
                {currentPin.images.map(img => (
                  <div key={img.id} className="relative aspect-square rounded-lg overflow-hidden border border-void-700">
                    {isVideoMedia(img) ? (
                      <video src={img.url} className="w-full h-full object-cover" controls playsInline preload="metadata" />
                    ) : (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={img.url} alt={img.originalName} className="w-full h-full object-cover" />
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {!isCreateMode && currentPin && !readOnly && (
            <div>
              <p className="text-xs text-gray-500 mb-2">Billeder og videoer</p>
              {currentPin.images.length > 0 && (
                <div className="grid grid-cols-3 gap-2 mb-2">
                  {currentPin.images.map(img => (
                    <div key={img.id} className="relative aspect-square rounded-lg overflow-hidden border border-void-700">
                      {isVideoMedia(img) ? (
                        <video src={img.url} className="w-full h-full object-cover" controls playsInline preload="metadata" />
                      ) : (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={img.url} alt={img.originalName} className="w-full h-full object-cover" />
                      )}
                      <button
                        onClick={() => handleDeleteImage(img.id)}
                        className="absolute top-1 right-1 w-6 h-6 bg-black/70 text-white rounded-full text-xs flex items-center justify-center"
                        aria-label="Slet mediefil"
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>
              )}
              <input
                ref={fileInputRef}
                type="file"
                accept={IMAGE_ACCEPT}
                multiple
                onChange={handleFileChange}
                className="hidden"
                id="pin-image-input"
              />
              <label htmlFor="pin-image-input" className="btn-secondary text-sm inline-flex items-center gap-2 cursor-pointer w-full justify-center">
                {uploading ? 'Uploader...' : '📷 Tilføj billede eller video'}
              </label>
            </div>
          )}

          {uploading && uploadProgress !== null && (
            <div className="space-y-1.5" role="status" aria-live="polite">
              <div className="flex items-center justify-between text-xs text-gray-400">
                <span>{uploadProgress >= 100 ? 'Behandler mediefil...' : 'Uploader mediefiler...'}</span>
                <span>{uploadProgress}%</span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-void-700">
                <div
                  className="h-full rounded-full bg-rust-500 transition-[width] duration-150"
                  style={{ width: `${uploadProgress}%` }}
                />
              </div>
            </div>
          )}

          {error && <p className="text-sm text-red-400 bg-red-900/20 border border-red-800/40 rounded-lg px-3 py-2">{error}</p>}

          <div className="flex gap-2 pt-1">
            {readOnly ? (
              <button onClick={handleClose} className="btn-secondary flex-1">Luk</button>
            ) : isCreateMode ? (
              <button onClick={handleSave} disabled={saving} className="btn-primary">
                {saving ? (uploading ? 'Uploader mediefiler...' : 'Gemmer...') : 'Gem pin'}
              </button>
            ) : (
              <>
                {isOwnPin && (
                  <button onClick={handleDeletePin} disabled={deleting} className="btn-danger flex-1">
                    {deleting ? 'Sletter...' : 'Slet'}
                  </button>
                )}
                <button onClick={handleClose} className="btn-secondary flex-1">Luk</button>
                <button onClick={handleUpdate} disabled={saving || !isDirty} className="btn-primary flex-1">
                  {saving ? 'Gemmer...' : 'Gem'}
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
