import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { getDataforsyningenToken, setDataforsyningenToken } from '@/lib/settings'

export async function GET() {
  const session = await getSession()
  if (!session || !session.isAdmin) return NextResponse.json({ error: 'Ingen adgang' }, { status: 403 })

  const token = await getDataforsyningenToken()
  return NextResponse.json({
    hasToken: !!token,
    maskedToken: token ? `${token.slice(0, 4)}••••••${token.slice(-4)}` : null,
  })
}

export async function POST(req: NextRequest) {
  const session = await getSession()
  if (!session || !session.isAdmin) return NextResponse.json({ error: 'Ingen adgang' }, { status: 403 })

  const body = await req.json()
  const token = typeof body.token === 'string' ? body.token.trim() : ''

  if (!token || token.length < 10 || token.length > 200) {
    return NextResponse.json({ error: 'Ugyldig token' }, { status: 400 })
  }

  await setDataforsyningenToken(token)
  return NextResponse.json({ success: true })
}
