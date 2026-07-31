'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import JSZip from 'jszip'
import type { Category } from '@/types/pin'
import type { ImportCandidate } from '@/lib/importCandidates'
import PinModal from './PinModal'

interface ParsedPlacemark {
  name: string
  description: string
  lat: number
  lng: number
}

function plainDescription(mark: Element): string {
  const raw = Array.from(mark.children).find(child => child.localName === 'description')?.textContent?.trim() ?? ''
  if (!raw) return ''
  const document = new DOMParser().parseFromString(`<body>${raw.replace(/<br\s*\/?\s*>/gi, '\n')}</body>`, 'text/html')
  const links = Array.from(document.body.querySelectorAll('a[href], img[src]'))
    .map(element => element.getAttribute(element.localName === 'img' ? 'src' : 'href'))
    .filter((value): value is string => !!value && !value.startsWith('data:'))
  const text = [document.body.textContent ?? '', ...links].join('\n')
  return Array.from(new Set(text.split('\n').map(line => line.trim()).filter(Boolean))).join('\n').slice(0, 2000)
}

function parseKml(kml: string, source: string): ParsedPlacemark[] {
  const document = new DOMParser().parseFromString(kml, 'application/xml')
  if (document.querySelector('parsererror')) throw new Error(`${source}: KML-filen er ugyldig`)

  return Array.from(document.getElementsByTagNameNS('*', 'Placemark')).flatMap((mark, index) => {
    const point = Array.from(mark.children).find(child => child.localName === 'Point')
    const coordinates = point
      ? Array.from(point.children).find(child => child.localName === 'coordinates')?.textContent
      : null
    if (!coordinates) return []
    const [lng, lat] = coordinates.trim().split(/[\s,]+/).map(Number)
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) return []
    const importedName = Array.from(mark.children).find(child => child.localName === 'name')?.textContent?.trim()
    return [{
      name: (importedName || `Importeret pin ${index + 1}`).slice(0, 200),
      description: plainDescription(mark),
      lat,
      lng,
    }]
  })
}

async function readImportFile(file: File): Promise<ParsedPlacemark[]> {
  if (file.size > 25 * 1024 * 1024) throw new Error(`${file.name}: Filen må højst fylde 25 MB`)
  if (file.name.toLowerCase().endsWith('.kml')) return parseKml(await file.text(), file.name)
  const zip = await JSZip.loadAsync(file)
  const kmlFiles = Object.values(zip.files).filter(entry => !entry.dir && entry.name.toLowerCase().endsWith('.kml'))
  if (kmlFiles.length === 0) throw new Error(`${file.name}: KMZ-filen indeholder ingen KML-fil`)
  const groups = await Promise.all(kmlFiles.map(async entry => parseKml(await entry.async('text'), file.name)))
  return groups.flat()
}

export default function KmzImport({ categories, initialCandidates }: { categories: Category[]; initialCandidates: ImportCandidate[] }) {
  const router = useRouter()
  const inputRef = useRef<HTMLInputElement>(null)
  const [candidates, setCandidates] = useState<ImportCandidate[]>(initialCandidates)
  const [listOpen, setListOpen] = useState(false)
  const [openId, setOpenId] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setCandidates(initialCandidates)
  }, [initialCandidates])

  async function selectFiles(files: FileList | null) {
    if (!files?.length) return
    setLoading(true)
    setError(null)
    try {
      const parsed = (await Promise.all(Array.from(files).map(readImportFile))).flat()
      if (parsed.length === 0) throw new Error('Der blev ikke fundet nogen punkt-pins i filerne')
      if (parsed.length > 2000) throw new Error('Der kan højst importeres 2.000 pins ad gangen')
      const res = await fetch('/api/import-candidates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: parsed }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Filen kunne ikke importeres')
      setListOpen(true)
      router.refresh()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Filen kunne ikke læses')
    } finally {
      setLoading(false)
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  async function removeCandidate(id: string) {
    setCandidates(previous => previous.filter(item => item.id !== id))
    await fetch(`/api/import-candidates/${id}`, { method: 'DELETE' })
    router.refresh()
  }

  const draft = candidates.find(item => item.id === openId) ?? null

  return (
    <>
      <input ref={inputRef} type="file" accept=".kmz,.kml,application/vnd.google-earth.kmz,application/vnd.google-earth.kml+xml" multiple className="hidden" onChange={event => void selectFiles(event.target.files)} />
      <button
        type="button"
        className="btn-secondary text-xs py-2 px-3 shrink-0"
        onClick={() => (candidates.length > 0 ? setListOpen(true) : inputRef.current?.click())}
        disabled={loading}
      >
        {loading ? 'Læser…' : candidates.length > 0 ? `⬆️ Import (${candidates.length} afventer)` : '⬆️ Importér KMZ'}
      </button>
      {error && <p className="fixed right-4 top-20 z-[2200] max-w-sm rounded-xl border border-red-800/60 bg-red-950 px-4 py-3 text-sm text-red-200 shadow-xl">{error}</p>}

      {listOpen && !draft && (
        <div className="ue-modal-backdrop fixed inset-0 z-[2000] flex items-end md:items-center justify-center bg-black/60" onClick={() => setListOpen(false)}>
          <div
            className="ue-modal-panel w-full md:max-w-md bg-void-900 md:rounded-2xl rounded-t-2xl border border-void-700 max-h-[85vh] overflow-y-auto"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-5 py-4 border-b border-void-700 sticky top-0 bg-void-900">
              <div className="min-w-0">
                <h2 className="font-semibold text-gray-100 truncate">KMZ-import</h2>
                <p className="text-xs text-gray-500">{candidates.length} afventer</p>
              </div>
              <div className="flex items-center gap-3 shrink-0">
                <button type="button" onClick={() => inputRef.current?.click()} className="text-xs text-rust-400 hover:text-rust-300">
                  + Tilføj filer
                </button>
                <button onClick={() => setListOpen(false)} className="text-gray-400 hover:text-gray-200 text-2xl leading-none px-1">×</button>
              </div>
            </div>
            <div>
              {candidates.length === 0 && (
                <p className="px-5 py-8 text-center text-sm text-gray-500">Ingen pins afventer import.</p>
              )}
              {candidates.map(item => (
                <div key={item.id} className="flex items-center gap-2 px-5 py-3 border-b border-void-800">
                  <button
                    type="button"
                    onClick={() => setOpenId(item.id)}
                    className="min-w-0 flex-1 text-left"
                  >
                    <p className="text-sm font-medium text-gray-200 truncate">{item.name}</p>
                    <p className="font-mono text-xs text-gray-500">{item.lat.toFixed(6)}, {item.lng.toFixed(6)}</p>
                  </button>
                  <button
                    type="button"
                    onClick={() => void removeCandidate(item.id)}
                    className="text-xs text-gray-400 hover:text-red-300 shrink-0"
                  >
                    Fjern
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {draft && (
        <PinModal
          key={draft.id}
          coords={{ lat: draft.lat, lng: draft.lng }}
          pin={null}
          categories={categories}
          initialValues={{ name: draft.name, description: draft.description }}
          createTitle={draft.name}
          onClose={() => setOpenId(null)}
          onCreated={() => {
            const id = draft.id
            setCandidates(previous => previous.filter(item => item.id !== id))
            setOpenId(null)
            void fetch(`/api/import-candidates/${id}`, { method: 'DELETE' }).then(() => router.refresh())
          }}
          onUpdated={() => {}}
          onDeleted={() => {}}
        />
      )}
    </>
  )
}
