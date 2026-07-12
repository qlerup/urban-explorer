import { NextRequest, NextResponse } from 'next/server'
import pool from '@/lib/db'
import { getSession } from '@/lib/auth'
import { countAdmins } from '@/lib/users'

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession()
  if (!session || !session.isAdmin) return NextResponse.json({ error: 'Ingen adgang' }, { status: 403 })

  const { id } = await params

  if (id === session.userId) {
    return NextResponse.json({ error: 'Du kan ikke slette din egen konto' }, { status: 400 })
  }

  const userResult = await pool.query('SELECT is_admin FROM users WHERE id = $1', [id])
  if (userResult.rows.length === 0) {
    return NextResponse.json({ error: 'Bruger findes ikke' }, { status: 404 })
  }

  if (userResult.rows[0].is_admin && (await countAdmins()) <= 1) {
    return NextResponse.json({ error: 'Kan ikke slette den sidste admin' }, { status: 400 })
  }

  await pool.query('DELETE FROM users WHERE id = $1', [id])
  return NextResponse.json({ success: true })
}
