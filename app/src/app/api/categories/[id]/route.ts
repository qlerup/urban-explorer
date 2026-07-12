import { NextRequest, NextResponse } from 'next/server'
import pool from '@/lib/db'
import { getSession } from '@/lib/auth'

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Ingen adgang' }, { status: 401 })

  const { id } = await params
  const body = await req.json()

  const hasName = typeof body.name === 'string'
  const hasColor = typeof body.color === 'string'

  if (!hasName && !hasColor) {
    return NextResponse.json({ error: 'Intet at opdatere' }, { status: 400 })
  }

  let name: string | undefined
  if (hasName) {
    name = body.name.trim()
    if (!name || name.length > 60) {
      return NextResponse.json({ error: 'Navn er påkrævet (maks 60 tegn)' }, { status: 400 })
    }
  }

  let color: string | undefined
  if (hasColor) {
    if (!/^#[0-9a-fA-F]{6}$/.test(body.color)) {
      return NextResponse.json({ error: 'Ugyldig farve' }, { status: 400 })
    }
    color = body.color
  }

  const result = await pool.query(
    `UPDATE categories SET
       name = COALESCE($1, name),
       color = COALESCE($2, color)
     WHERE id = $3 AND user_id = $4
     RETURNING id, name, color`,
    [name ?? null, color ?? null, id, session.userId]
  ).catch((err: { code?: string }) => {
    if (err.code === '23505') return null
    throw err
  })

  if (!result) return NextResponse.json({ error: 'Du har allerede en kategori med det navn' }, { status: 400 })
  if (result.rowCount === 0) return NextResponse.json({ error: 'Kategori ikke fundet' }, { status: 404 })
  return NextResponse.json({ category: result.rows[0] })
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Ingen adgang' }, { status: 401 })

  const { id } = await params

  const result = await pool.query(
    'DELETE FROM categories WHERE id = $1 AND user_id = $2 RETURNING id',
    [id, session.userId]
  )

  if (result.rowCount === 0) return NextResponse.json({ error: 'Kategori ikke fundet' }, { status: 404 })
  return NextResponse.json({ success: true })
}
