import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { getMaptilerKey, setMaptilerKey } from '@/lib/settings'

export async function GET() {
  const session = await getSession()
  if (!session || !session.isAdmin) return NextResponse.json({ error: 'Ingen adgang' }, { status: 403 })

  const key = await getMaptilerKey()
  return NextResponse.json({
    hasKey: !!key,
    maskedKey: key ? `${key.slice(0, 4)}••••••${key.slice(-4)}` : null,
  })
}

export async function POST(req: NextRequest) {
  const session = await getSession()
  if (!session || !session.isAdmin) return NextResponse.json({ error: 'Ingen adgang' }, { status: 403 })

  const body = await req.json()
  const key = typeof body.key === 'string' ? body.key.trim() : ''

  if (!key || key.length < 10 || key.length > 200) {
    return NextResponse.json({ error: 'Ugyldig API-nøgle' }, { status: 400 })
  }

  await setMaptilerKey(key)
  return NextResponse.json({ success: true })
}
