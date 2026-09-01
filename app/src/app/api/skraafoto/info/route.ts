import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { getDataforsyningenToken } from '@/lib/settings'
import { parseAllowedDataforsyningenUrl, describeRejectedUrl } from '@/lib/skraafoto'

export const dynamic = 'force-dynamic'

const COGTILER_INFO_URL = 'https://api.dataforsyningen.dk/rest/skraafoto_cogtiler/v1.0/info'

export async function GET(request: NextRequest) {
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

  const upstreamUrl = new URL(COGTILER_INFO_URL)
  upstreamUrl.searchParams.set('url', cogUrl.toString())

  try {
    const upstream = await fetch(upstreamUrl, {
      cache: 'no-store',
      headers: { token },
    })
    if (!upstream.ok) {
      return NextResponse.json({ error: 'Billedinfo kunne ikke hentes' }, { status: 502 })
    }

    const info = await upstream.json()
    return NextResponse.json(info)
  } catch {
    return NextResponse.json({ error: 'Billedinfo kunne ikke hentes' }, { status: 502 })
  }
}
