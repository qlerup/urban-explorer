import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { getGridCellsForUser, setGridCellSearched } from '@/lib/grid'

export async function GET() {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Ingen adgang' }, { status: 401 })

  const cells = await getGridCellsForUser(session.userId)
  return NextResponse.json({ cells })
}

export async function POST(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Ingen adgang' }, { status: 401 })

  const body = await req.json()
  const row = Number(body.row)
  const col = Number(body.col)
  const searched = Boolean(body.searched)

  if (!Number.isInteger(row) || !Number.isInteger(col)) {
    return NextResponse.json({ error: 'Ugyldigt felt' }, { status: 400 })
  }

  await setGridCellSearched(session.userId, row, col, searched)
  return NextResponse.json({ success: true })
}
