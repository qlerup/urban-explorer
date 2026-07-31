'use client'

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import JSZip from 'jszip'
import type { Category, PinStatus } from '@/types/pin'
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
      icon: '📍',
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
  const [current, setCurrent] = useState(0)
  const [saved, setSaved] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function closeImport() {
    if (queue.length > 0 && !confirm('Luk importen? Pins, du ikke har gemt, bliver ikke importeret.')) return
    setQueue([])
    setCurrent(0)
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
      setCurrent(0)
      setSaved(0)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Filen kunne ikke læses')
    } finally {
      setLoading(false)
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  function removeCurrent() {
    setQueue(previous => previous.filter((_, index) => index !== current))
    setCurrent(previous => Math.max(0, Math.min(previous, queue.length - 2)))
  }

  const draft = queue[current]
  return (
    <>
      <input ref={inputRef} type="file" accept=".kmz,.kml,application/vnd.google-earth.kmz,application/vnd.google-earth.kml+xml" multiple className="hidden" onChange={event => void selectFiles(event.target.files)} />
      <button type="button" className="btn-primary text-xs py-2 px-3 shrink-0" onClick={() => inputRef.current?.click()} disabled={loading}>
        {loading ? 'Læser…' : '⬆️ Importér KMZ'}
      </button>
      {error && <p className="fixed right-4 top-20 z-[2200] max-w-sm rounded-xl border border-red-800/60 bg-red-950 px-4 py-3 text-sm text-red-200 shadow-xl">{error}</p>}

      {draft && (
        <>
          <div className="fixed left-3 top-3 z-[2050] max-w-[calc(100vw-6rem)] rounded-xl border border-void-600 bg-void-950/95 px-3 py-2 shadow-xl md:left-5 md:top-20 md:w-64">
            <div className="flex items-center gap-2">
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs font-semibold text-gray-100">KMZ-import</p>
                <p className="text-[11px] text-gray-400">{current + 1} af {queue.length} · {saved} gemt</p>
              </div>
              <button type="button" onClick={removeCurrent} className="text-xs text-gray-400 hover:text-red-300">Spring over</button>
            </div>
            <div className="mt-2 hidden max-h-52 overflow-y-auto border-t border-void-700 pt-2 md:block">
              {queue.map((item, index) => (
                <button key={item.id} type="button" onClick={() => {
                  if (index !== current && confirm('Skift pin? Ændringer i den åbne pin bliver nulstillet.')) setCurrent(index)
                }} className={`block w-full truncate rounded px-2 py-1 text-left text-xs ${index === current ? 'bg-rust-600/20 text-rust-400' : 'text-gray-500 hover:bg-void-800'}`}>
                  {index + 1}. {item.name}
                </button>
              ))}
            </div>
          </div>
          <PinModal
            key={draft.id}
            coords={{ lat: draft.lat, lng: draft.lng }}
            pin={null}
            categories={categories}
            initialValues={draft}
            createTitle={`Importér pin ${current + 1} af ${queue.length}`}
            onClose={closeImport}
            onCreated={() => {
              setSaved(value => value + 1)
              setQueue(previous => previous.filter((_, index) => index !== current))
              setCurrent(previous => Math.max(0, Math.min(previous, queue.length - 2)))
              router.refresh()
            }}
            onUpdated={() => {}}
            onDeleted={() => {}}
          />
        </>
      )}
    </>
  )
}
