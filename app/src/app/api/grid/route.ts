import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { getGridCellsForUser, getGridWorkspaceAccess, setGridCellSearched } from '@/lib/grid'

export async function GET(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Ingen adgang' }, { status: 401 })

  const requestedOwnerId = req.nextUrl.searchParams.get('ownerId') || session.userId
  const access = await getGridWorkspaceAccess(session.userId, requestedOwnerId)
  if (!access.canView) return NextResponse.json({ error: 'Ingen adgang' }, { status: 403 })

  const cells = await getGridCellsForUser(requestedOwnerId)
  return NextResponse.json({ cells, canEdit: access.canEdit })
}

export async function POST(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Ingen adgang' }, { status: 401 })

  const body = await req.json()
  const row = Number(body.row)
  const col = Number(body.col)
  const searched = Boolean(body.searched)
  const ownerId = typeof body.ownerId === 'string' && body.ownerId ? body.ownerId : session.userId

  if (!Number.isInteger(row) || !Number.isInteger(col)) {
    return NextResponse.json({ error: 'Ugyldigt felt' }, { status: 400 })
  }

  const access = await getGridWorkspaceAccess(session.userId, ownerId)
  if (!access.canEdit) return NextResponse.json({ error: 'Du har kun læseadgang' }, { status: 403 })

  await setGridCellSearched(ownerId, row, col, searched)
  return NextResponse.json({ success: true })
}
