import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { getDataforsyningenToken } from '@/lib/settings'
import { parseAllowedDataforsyningenUrl } from '@/lib/skraafoto'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  if (!(await getSession())) return new NextResponse(null, { status: 401 })

  const token = (await getDataforsyningenToken())?.trim()
  if (!token) {
    return NextResponse.json({ error: 'Dataforsyningen-token mangler' }, { status: 503 })
  }

  const upstreamUrl = parseAllowedDataforsyningenUrl(request.nextUrl.searchParams.get('url'))
  if (!upstreamUrl) {
    return NextResponse.json({ error: 'Ugyldig billed-URL' }, { status: 400 })
  }

  try {
    const upstream = await fetch(upstreamUrl, {
      cache: 'no-store',
      headers: { token },
    })
    if (!upstream.ok) {
      return NextResponse.json({ error: 'Thumbnail kunne ikke hentes' }, { status: 502 })
    }

    const contentType = upstream.headers.get('content-type') ?? ''
    if (!contentType.startsWith('image/')) {
      return NextResponse.json({ error: 'Thumbnail-svaret var ikke et billede' }, { status: 502 })
    }

    return new NextResponse(upstream.body, {
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'private, max-age=86400',
      },
    })
  } catch {
    return NextResponse.json({ error: 'Thumbnail kunne ikke hentes' }, { status: 502 })
  }
}
