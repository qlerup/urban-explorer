'use client'

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import JSZip from 'jszip'

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

export default function KmzImport() {
  const router = useRouter()
  const inputRef = useRef<HTMLInputElement>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

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
      router.refresh()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Filen kunne ikke læses')
    } finally {
      setLoading(false)
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  return (
    <>
      <input ref={inputRef} type="file" accept=".kmz,.kml,application/vnd.google-earth.kmz,application/vnd.google-earth.kml+xml" multiple className="hidden" onChange={event => void selectFiles(event.target.files)} />
      <button type="button" className="btn-secondary text-xs py-2 px-3 shrink-0" onClick={() => inputRef.current?.click()} disabled={loading}>
        {loading ? 'Læser…' : '⬆️ Importér KMZ'}
      </button>
      {error && <p className="fixed right-4 top-20 z-[2200] max-w-sm rounded-xl border border-red-800/60 bg-red-950 px-4 py-3 text-sm text-red-200 shadow-xl">{error}</p>}
    </>
  )
}
