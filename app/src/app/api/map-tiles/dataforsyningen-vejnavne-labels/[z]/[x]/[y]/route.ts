import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { getDataforsyningenToken } from '@/lib/settings'

export const dynamic = 'force-dynamic'

const FORVALTNING2_WMS_URL = 'https://api.dataforsyningen.dk/wms/forvaltning2'
const MAX_TILE_ZOOM = 20
const TILE_SIZE = 256

// Jordens omkreds i meter (Web Mercator / EPSG:3857) og halvdelen af den,
// brugt til at omregne en XYZ-flise til dens bounding box i samme projektion.
const EARTH_CIRCUMFERENCE_M = 40075016.68557849
const ORIGIN_SHIFT_M = EARTH_CIRCUMFERENCE_M / 2

function parseTileCoordinate(value: string, max: number): number | null {
  if (!/^\d+$/.test(value)) return null
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed >= 0 && parsed <= max ? parsed : null
}

function tileToWebMercatorBBox(z: number, x: number, y: number) {
  const tileSizeM = EARTH_CIRCUMFERENCE_M / 2 ** z
  const minX = x * tileSizeM - ORIGIN_SHIFT_M
  const maxX = (x + 1) * tileSizeM - ORIGIN_SHIFT_M
  const maxY = ORIGIN_SHIFT_M - y * tileSizeM
  const minY = ORIGIN_SHIFT_M - (y + 1) * tileSizeM
  return { minX, minY, maxX, maxY }
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ z: string; x: string; y: string }> }
) {
  if (!(await getSession())) return new NextResponse(null, { status: 401 })

  const token = (await getDataforsyningenToken())?.trim()
  if (!token) {
    return NextResponse.json({ error: 'Dataforsyningen-token mangler' }, { status: 503 })
  }

  const raw = await params
  const z = parseTileCoordinate(raw.z, MAX_TILE_ZOOM)
  if (z === null) return NextResponse.json({ error: 'Ugyldigt zoomniveau' }, { status: 400 })

  const coordinateMax = 2 ** z - 1
  const x = parseTileCoordinate(raw.x, coordinateMax)
  const y = parseTileCoordinate(raw.y, coordinateMax)
  if (x === null || y === null) {
    return NextResponse.json({ error: 'Ugyldige kortkoordinater' }, { status: 400 })
  }

  const { minX, minY, maxX, maxY } = tileToWebMercatorBBox(z, x, y)

  const upstreamUrl = new URL(FORVALTNING2_WMS_URL)
  upstreamUrl.search = new URLSearchParams({
    SERVICE: 'WMS',
    REQUEST: 'GetMap',
    VERSION: '1.3.0',
    LAYERS: 'Vejnavne_ortofoto',
    STYLES: '',
    CRS: 'EPSG:3857',
    BBOX: `${minX},${minY},${maxX},${maxY}`,
    WIDTH: String(TILE_SIZE),
    HEIGHT: String(TILE_SIZE),
    FORMAT: 'image/png',
    TRANSPARENT: 'TRUE',
  }).toString()

  try {
    const upstream = await fetch(upstreamUrl, {
      cache: 'no-store',
      headers: { token },
    })
    if (!upstream.ok) {
      return NextResponse.json({ error: 'Vejnavne-laget kunne ikke hentes' }, { status: 502 })
    }

    const contentType = upstream.headers.get('content-type') ?? ''
    if (!contentType.startsWith('image/')) {
      return NextResponse.json({ error: 'Vejnavne-laget returnerede ikke et kortbillede' }, { status: 502 })
    }

    return new NextResponse(upstream.body, {
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'private, max-age=86400',
      },
    })
  } catch {
    return NextResponse.json({ error: 'Vejnavne-laget kunne ikke hentes' }, { status: 502 })
  }
}
