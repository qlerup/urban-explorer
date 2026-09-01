import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { getDataforsyningenToken } from '@/lib/settings'
import { encodeUpstreamUrl } from '@/lib/skraafoto'

export const dynamic = 'force-dynamic'

const SKRAAFOTO_SEARCH_URL = 'https://api.dataforsyningen.dk/rest/skraafoto_api/v1.0/search'

type SkraafotoDirection = 'north' | 'south' | 'east' | 'west'
const VALID_DIRECTIONS: SkraafotoDirection[] = ['north', 'south', 'east', 'west']

interface StacItem {
  id: string
  properties?: { direction?: string; datetime?: string }
  assets?: { thumbnail?: { href?: string }; data?: { href?: string } }
}

export async function GET(request: NextRequest) {
  if (!(await getSession())) return new NextResponse(null, { status: 401 })

  const token = (await getDataforsyningenToken())?.trim()
  if (!token) {
    return NextResponse.json({ error: 'Dataforsyningen-token mangler' }, { status: 503 })
  }

  const lat = Number(request.nextUrl.searchParams.get('lat'))
  const lon = Number(request.nextUrl.searchParams.get('lon'))
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180) {
    return NextResponse.json({ error: 'Ugyldige koordinater' }, { status: 400 })
  }

  try {
    const upstream = await fetch(SKRAAFOTO_SEARCH_URL, {
      method: 'POST',
      cache: 'no-store',
      headers: { token, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        'filter-lang': 'cql-json',
        filter: {
          intersects: [{ property: 'geometry' }, { type: 'Point', coordinates: [lon, lat] }],
        },
        'filter-crs': 'http://www.opengis.net/def/crs/OGC/1.3/CRS84',
        crs: 'http://www.opengis.net/def/crs/OGC/1.3/CRS84',
        limit: 200,
      }),
    })

    if (!upstream.ok) {
      return NextResponse.json({ error: 'Skråfoto-søgningen fejlede' }, { status: 502 })
    }

    const data = await upstream.json()
    const features: StacItem[] = Array.isArray(data?.features) ? data.features : []

    const photos = features
      .filter(item => VALID_DIRECTIONS.includes(item.properties?.direction as SkraafotoDirection))
      .filter(item => item.assets?.data?.href && item.assets?.thumbnail?.href)
      .map(item => {
        const datetime = item.properties!.datetime ?? ''
        const year = datetime ? new Date(datetime).getUTCFullYear() : 0
        return {
          id: item.id,
          direction: item.properties!.direction as SkraafotoDirection,
          year,
          datetime,
          thumbnailUrl: `/api/skraafoto/thumbnail?url=${encodeUpstreamUrl(item.assets!.thumbnail!.href!)}`,
          cogUrl: item.assets!.data!.href!,
        }
      })
      .sort((a, b) => (a.datetime < b.datetime ? 1 : a.datetime > b.datetime ? -1 : 0))

    return NextResponse.json({ photos })
  } catch {
    return NextResponse.json({ error: 'Skråfoto-søgningen fejlede' }, { status: 502 })
  }
}
