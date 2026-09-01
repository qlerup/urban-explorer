import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { getDataforsyningenToken } from '@/lib/settings'
import { parseAllowedDataforsyningenUrl } from '@/lib/skraafoto'

export const dynamic = 'force-dynamic'

function copyResponseHeaders(upstream: Response): Headers {
  const headers = new Headers()
  const allowed = [
    'accept-ranges',
    'cache-control',
    'content-length',
    'content-range',
    'content-type',
    'etag',
    'last-modified',
  ]

  for (const name of allowed) {
    const value = upstream.headers.get(name)
    if (value) headers.set(name, value)
  }

  // GeoTIFF.js/OpenLayers bruger HTTP Range requests mod COG-filen.
  // Hvis upstream ikke eksplicit sender headeren, annoncerer vi stadig byte ranges.
  if (!headers.has('accept-ranges')) headers.set('Accept-Ranges', 'bytes')
  if (!headers.has('cache-control')) headers.set('Cache-Control', 'private, max-age=86400')
  return headers
}

async function proxyCog(request: NextRequest, headOnly: boolean) {
  if (!(await getSession())) return new NextResponse(null, { status: 401 })

  const token = (await getDataforsyningenToken())?.trim()
  if (!token) {
    return NextResponse.json({ error: 'Dataforsyningen-token mangler' }, { status: 503 })
  }

  const upstreamUrl = parseAllowedDataforsyningenUrl(request.nextUrl.searchParams.get('url'))
  if (!upstreamUrl) {
    return NextResponse.json({ error: 'Ugyldig billed-URL' }, { status: 400 })
  }

  const headers: Record<string, string> = { token }
  const range = request.headers.get('range')
  if (range) headers.Range = range

  try {
    const upstream = await fetch(upstreamUrl, {
      method: headOnly ? 'HEAD' : 'GET',
      cache: 'no-store',
      headers,
    })

    if (!upstream.ok && upstream.status !== 206) {
      return NextResponse.json({ error: 'Skråfoto kunne ikke hentes' }, { status: 502 })
    }

    const responseHeaders = copyResponseHeaders(upstream)
    const contentType = responseHeaders.get('content-type') ?? ''
    if (!headOnly && contentType && !contentType.includes('tiff') && !contentType.includes('octet-stream')) {
      return NextResponse.json({ error: 'Skråfoto-svaret var ikke en GeoTIFF' }, { status: 502 })
    }

    return new NextResponse(headOnly ? null : upstream.body, {
      status: upstream.status,
      headers: responseHeaders,
    })
  } catch {
    return NextResponse.json({ error: 'Skråfoto kunne ikke hentes' }, { status: 502 })
  }
}

export async function GET(request: NextRequest) {
  return proxyCog(request, false)
}

export async function HEAD(request: NextRequest) {
  return proxyCog(request, true)
}
