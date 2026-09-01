import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { getDataforsyningenToken } from '@/lib/settings'
import { parseAllowedDataforsyningenUrl, describeRejectedUrl } from '@/lib/skraafoto'

export const dynamic = 'force-dynamic'

const COGTILER_TILES_URL = 'https://api.dataforsyningen.dk/rest/skraafoto_cogtiler/v1.0/tiles'
const MAX_TILE_ZOOM = 30
const MAX_TILE_INDEX = 1_000_000

function parseTileCoordinate(value: string, max: number): number | null {
  if (!/^\d+$/.test(value)) return null
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed >= 0 && parsed <= max ? parsed : null
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ z: string; x: string; y: string }> }
) {
  if (!(await getSession())) return new NextResponse(null, { status: 401 })

  const token = (await getDataforsyningenToken())?.trim()
  if (!token) {
    return NextResponse.json({ error: 'Dataforsyningen-token mangler' }, { status: 503 })
  }

  const rawUrl = request.nextUrl.searchParams.get('url')
  const cogUrl = parseAllowedDataforsyningenUrl(rawUrl)
  if (!cogUrl) {
    return NextResponse.json({ error: `Ugyldig billed-URL (${describeRejectedUrl(rawUrl)})` }, { status: 400 })
  }

  const raw = await params
  const z = parseTileCoordinate(raw.z, MAX_TILE_ZOOM)
  const x = parseTileCoordinate(raw.x, MAX_TILE_INDEX)
  const y = parseTileCoordinate(raw.y, MAX_TILE_INDEX)
  if (z === null || x === null || y === null) {
    return NextResponse.json({ error: 'Ugyldige fliskoordinater' }, { status: 400 })
  }

  const upstreamUrl = new URL(`${COGTILER_TILES_URL}/${z}/${x}/${y}.jpg`)
  upstreamUrl.searchParams.set('url', cogUrl.toString())

  try {
    const upstream = await fetch(upstreamUrl, {
      cache: 'no-store',
      headers: { token },
    })
    if (!upstream.ok) {
      return NextResponse.json({ error: 'Skråfoto-flisen kunne ikke hentes' }, { status: 502 })
    }

    const contentType = upstream.headers.get('content-type') ?? ''
    if (!contentType.startsWith('image/')) {
      return NextResponse.json({ error: 'Skråfoto-flisen var ikke et billede' }, { status: 502 })
    }

    return new NextResponse(upstream.body, {
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'private, max-age=86400',
      },
    })
  } catch {
    return NextResponse.json({ error: 'Skråfoto-flisen kunne ikke hentes' }, { status: 502 })
  }
}
