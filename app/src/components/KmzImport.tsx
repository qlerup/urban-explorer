'use client'

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import JSZip from 'jszip'
import { PIN_ICON_OPTIONS, type Category, type PinStatus } from '@/types/pin'
import PinModal from './PinModal'

interface ImportedPin {
  id: string
  source: string
  name: string
  description: string
  lat: number
  lng: number
  rating: number
  status: PinStatus
  icon: string
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

function parseKml(kml: string, source: string): ImportedPin[] {
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
      id: `${source}-${index}-${lat}-${lng}`,
      source,
      name: (importedName || `Importeret pin ${index + 1}`).slice(0, 200),
      description: plainDescription(mark),
      lat,
      lng,
      rating: 0,
      status: 'vil_se' as PinStatus,
      icon: PIN_ICON_OPTIONS[0],
    }]
  })
}

async function readImportFile(file: File): Promise<ImportedPin[]> {
  if (file.size > 25 * 1024 * 1024) throw new Error(`${file.name}: Filen må højst fylde 25 MB`)
  if (file.name.toLowerCase().endsWith('.kml')) return parseKml(await file.text(), file.name)
  const zip = await JSZip.loadAsync(file)
  const kmlFiles = Object.values(zip.files).filter(entry => !entry.dir && entry.name.toLowerCase().endsWith('.kml'))
  if (kmlFiles.length === 0) throw new Error(`${file.name}: KMZ-filen indeholder ingen KML-fil`)
  const groups = await Promise.all(kmlFiles.map(async entry => parseKml(await entry.async('text'), file.name)))
  return groups.flat()
}

export default function KmzImport({ categories }: { categories: Category[] }) {
  const router = useRouter()
  const inputRef = useRef<HTMLInputElement>(null)
  const [queue, setQueue] = useState<ImportedPin[]>([])
  const [openId, setOpenId] = useState<string | null>(null)
  const [saved, setSaved] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function closeList() {
    if (queue.length > 0 && !confirm('Luk importen? De resterende pins bliver ikke importeret.')) return
    setQueue([])
    setOpenId(null)
    if (saved > 0) router.refresh()
    setSaved(0)
  }

  async function selectFiles(files: FileList | null) {
    if (!files?.length) return
    setLoading(true)
    setError(null)
    try {
      const results = (await Promise.all(Array.from(files).map(readImportFile))).flat()
      if (results.length === 0) throw new Error('Der blev ikke fundet nogen punkt-pins i filerne')
      if (results.length > 2000) throw new Error('Der kan højst importeres 2.000 pins ad gangen')
      setQueue(results)
      setOpenId(null)
      setSaved(0)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Filen kunne ikke læses')
    } finally {
      setLoading(false)
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  function removeFromQueue(id: string) {
    setQueue(previous => previous.filter(item => item.id !== id))
  }

  const draft = queue.find(item => item.id === openId) ?? null

  return (
    <>
      <input ref={inputRef} type="file" accept=".kmz,.kml,application/vnd.google-earth.kmz,application/vnd.google-earth.kml+xml" multiple className="hidden" onChange={event => void selectFiles(event.target.files)} />
      <button type="button" className="btn-primary text-xs py-2 px-3 shrink-0" onClick={() => inputRef.current?.click()} disabled={loading}>
        {loading ? 'Læser…' : '⬆️ Importér KMZ'}
      </button>
      {error && <p className="fixed right-4 top-20 z-[2200] max-w-sm rounded-xl border border-red-800/60 bg-red-950 px-4 py-3 text-sm text-red-200 shadow-xl">{error}</p>}

      {queue.length > 0 && !draft && (
        <div className="ue-modal-backdrop fixed inset-0 z-[2000] flex items-end md:items-center justify-center bg-black/60" onClick={closeList}>
          <div
            className="ue-modal-panel w-full md:max-w-md bg-void-900 md:rounded-2xl rounded-t-2xl border border-void-700 max-h-[85vh] overflow-y-auto"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-5 py-4 border-b border-void-700 sticky top-0 bg-void-900">
              <div className="min-w-0">
                <h2 className="font-semibold text-gray-100 truncate">KMZ-import</h2>
                <p className="text-xs text-gray-500">{queue.length} tilbage · {saved} gemt</p>
              </div>
              <button onClick={closeList} className="text-gray-400 hover:text-gray-200 text-2xl leading-none px-1">×</button>
            </div>
            <div>
              {queue.map(item => (
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
                    onClick={() => removeFromQueue(item.id)}
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
          initialValues={draft}
          createTitle={draft.name}
          onClose={() => setOpenId(null)}
          onCreated={() => {
            setSaved(value => value + 1)
            setQueue(previous => previous.filter(item => item.id !== draft.id))
            setOpenId(null)
            router.refresh()
          }}
          onUpdated={() => {}}
          onDeleted={() => {}}
        />
      )}
    </>
  )
}
