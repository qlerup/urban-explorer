import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { getForgotPasswordEnabled, setForgotPasswordEnabled } from '@/lib/settings'

export async function GET() {
  const session = await getSession()
  if (!session || !session.isAdmin) return NextResponse.json({ error: 'Ingen adgang' }, { status: 403 })

  const enabled = await getForgotPasswordEnabled()
  return NextResponse.json({ enabled })
}

export async function POST(req: NextRequest) {
  const session = await getSession()
  if (!session || !session.isAdmin) return NextResponse.json({ error: 'Ingen adgang' }, { status: 403 })

  const body = await req.json().catch(() => ({}))
  await setForgotPasswordEnabled(Boolean(body.enabled))
  return NextResponse.json({ success: true })
}
