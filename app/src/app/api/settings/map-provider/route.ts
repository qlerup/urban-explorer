import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { getMapProvider, setMapProvider } from '@/lib/settings'

export async function GET() {
  const session = await getSession()
  if (!session || !session.isAdmin) return NextResponse.json({ error: 'Ingen adgang' }, { status: 403 })

  const provider = await getMapProvider()
  return NextResponse.json({ provider })
}

export async function POST(req: NextRequest) {
  const session = await getSession()
  if (!session || !session.isAdmin) return NextResponse.json({ error: 'Ingen adgang' }, { status: 403 })

  const body = await req.json()
  const provider = body.provider

  if (provider !== 'maptiler' && provider !== 'esri') {
    return NextResponse.json({ error: 'Ugyldig kortudbyder' }, { status: 400 })
  }

  await setMapProvider(provider)
  return NextResponse.json({ success: true })
}
