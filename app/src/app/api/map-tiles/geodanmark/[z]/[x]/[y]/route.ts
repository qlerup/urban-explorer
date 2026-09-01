import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { getDataforsyningenToken } from '@/lib/settings'

export const dynamic = 'force-dynamic'

const GEODANMARK_WMTS_URL = 'https://api.dataforsyningen.dk/orto_foraar_webm_DAF'
const MAX_TILE_ZOOM = 20

function parseTileCoordinate(value: string, max: number): number | null {
  if (!/^\d+$/.test(value)) return null
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed >= 0 && parsed <= max ? parsed : null
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

  const upstreamUrl = new URL(GEODANMARK_WMTS_URL)
  upstreamUrl.search = new URLSearchParams({
    SERVICE: 'WMTS',
    REQUEST: 'GetTile',
    VERSION: '1.0.0',
    LAYER: 'orto_foraar_webm',
    STYLE: 'default',
    FORMAT: 'image/jpeg',
    TILEMATRIXSET: 'DFD_GoogleMapsCompatible',
    TILEMATRIX: String(z),
    TILEROW: String(y),
    TILECOL: String(x),
  }).toString()

  try {
    const upstream = await fetch(upstreamUrl, {
      cache: 'no-store',
      headers: { token },
    })
    if (!upstream.ok) {
      return NextResponse.json({ error: 'GeoDanmark-kortet kunne ikke hentes' }, { status: 502 })
    }

    const contentType = upstream.headers.get('content-type') ?? ''
    if (!contentType.startsWith('image/')) {
      return NextResponse.json({ error: 'GeoDanmark returnerede ikke et kortbillede' }, { status: 502 })
    }

    return new NextResponse(upstream.body, {
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'private, max-age=86400',
      },
    })
  } catch {
    return NextResponse.json({ error: 'GeoDanmark-kortet kunne ikke hentes' }, { status: 502 })
  }
}
