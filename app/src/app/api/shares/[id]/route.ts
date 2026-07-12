import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { getSession } from '@/lib/auth'
import { deleteShareLink, updateShareLink } from '@/lib/shares'

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Ingen adgang' }, { status: 401 })

  const { id } = await params
  const body = await req.json().catch(() => ({}))
  const label = typeof body.label === 'string' ? body.label.trim().slice(0, 100) : ''
  const pinIds = Array.isArray(body.pinIds) ? body.pinIds.filter((pinId: unknown) => typeof pinId === 'string') : []

  if (pinIds.length === 0) {
    return NextResponse.json({ error: 'Vaelg mindst en pin at dele' }, { status: 400 })
  }

  const result = await updateShareLink(session.userId, id, label, pinIds)
  if (result.status === 'not_found') {
    return NextResponse.json({ error: 'Link ikke fundet' }, { status: 404 })
  }
  if (result.status === 'no_pins') {
    return NextResponse.json({ error: 'Ingen af de valgte pins kunne deles' }, { status: 400 })
  }

  return NextResponse.json({ share: result.share })
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Ingen adgang' }, { status: 401 })

  const { id } = await params
  const ok = await deleteShareLink(id, session.userId)
  if (!ok) return NextResponse.json({ error: 'Link ikke fundet' }, { status: 404 })

  return NextResponse.json({ success: true })
}
