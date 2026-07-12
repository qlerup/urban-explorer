import archiver from 'archiver'
import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { getPinsForExport } from '@/lib/pins'
import { buildKml } from '@/lib/kml'
import { readImage } from '@/lib/uploads'
import { createMarkerIconPng } from '@/lib/icons'

export async function GET() {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Ingen adgang' }, { status: 401 })

  const pins = await getPinsForExport(session.userId)
  const { kml, styles } = buildKml(pins)

  const archive = archiver('zip', { zlib: { level: 9 } })
  const chunks: Buffer[] = []
  archive.on('data', (chunk: Buffer) => chunks.push(chunk))
  const done = new Promise<void>((resolve, reject) => {
    archive.on('end', resolve)
    archive.on('error', reject)
  })

  archive.append(kml, { name: 'doc.kml' })

  for (const style of styles) {
    archive.append(createMarkerIconPng(style.icon), { name: `icons/${style.id}.png` })
  }

  for (const pin of pins) {
    for (const image of pin.images) {
      try {
        const buffer = await readImage(pin.id, image.filename)
        archive.append(buffer, { name: `images/${image.filename}` })
      } catch {
        // Billedfil mangler på disk — spring over i stedet for at fejle hele eksporten
      }
    }
  }

  await archive.finalize()
  await done

  return new NextResponse(new Uint8Array(Buffer.concat(chunks)), {
    headers: {
      'Content-Type': 'application/vnd.google-earth.kmz',
      'Content-Disposition': 'attachment; filename="urban-explorer-eksport.kmz"',
    },
  })
}
