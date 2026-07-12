import { NextRequest, NextResponse } from 'next/server'
import pool from '@/lib/db'
import { getSession } from '@/lib/auth'
import { getCategoriesForUser, getCategoriesSharedWithUser } from '@/lib/categories'

export async function GET() {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Ingen adgang' }, { status: 401 })

  const [categories, shared] = await Promise.all([
    getCategoriesForUser(session.userId),
    getCategoriesSharedWithUser(session.userId),
  ])
  return NextResponse.json({ categories, shared })
}

export async function POST(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Ingen adgang' }, { status: 401 })

  const body = await req.json()
  const name = typeof body.name === 'string' ? body.name.trim() : ''
  const color = typeof body.color === 'string' && /^#[0-9a-fA-F]{6}$/.test(body.color) ? body.color : '#e08a3c'

  if (!name || name.length > 60) {
    return NextResponse.json({ error: 'Navn er påkrævet (maks 60 tegn)' }, { status: 400 })
  }

  const result = await pool.query(
    'INSERT INTO categories (user_id, name, color) VALUES ($1, $2, $3) RETURNING id, name, color',
    [session.userId, name, color]
  ).catch((err: { code?: string }) => {
    if (err.code === '23505') return null
    throw err
  })

  if (!result) {
    return NextResponse.json({ error: 'Du har allerede en kategori med det navn' }, { status: 400 })
  }

  return NextResponse.json({ category: result.rows[0] })
}
