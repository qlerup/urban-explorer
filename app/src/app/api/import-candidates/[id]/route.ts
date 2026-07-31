import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { deleteImportCandidate } from '@/lib/importCandidates'

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Ingen adgang' }, { status: 401 })

  const { id } = await params
  await deleteImportCandidate(session.userId, id)
  return NextResponse.json({ success: true })
}
