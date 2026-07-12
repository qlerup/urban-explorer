import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { getShareLinksForUser, createShareLink } from '@/lib/shares'

export async function GET() {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Ingen adgang' }, { status: 401 })

  const shares = await getShareLinksForUser(session.userId)
  return NextResponse.json({ shares })
}

export async function POST(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Ingen adgang' }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  const label = typeof body.label === 'string' ? body.label.trim().slice(0, 100) : ''
  const pinIds = Array.isArray(body.pinIds) ? body.pinIds.filter((id: unknown) => typeof id === 'string') : []

  if (pinIds.length === 0) {
    return NextResponse.json({ error: 'Vælg mindst én pin at dele' }, { status: 400 })
  }

  const share = await createShareLink(session.userId, label, pinIds)
  if (!share) {
    return NextResponse.json({ error: 'Ingen af de valgte pins kunne deles' }, { status: 400 })
  }

  return NextResponse.json({ share })
}
