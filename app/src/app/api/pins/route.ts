import { NextRequest, NextResponse } from 'next/server'
import pool from '@/lib/db'
import { getSession } from '@/lib/auth'
import { getPinsForUser, mapPinRow } from '@/lib/pins'
import { canUseCategory } from '@/lib/categories'
import { isPinStatus, PIN_ICON_OPTIONS } from '@/types/pin'

export async function GET() {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Ingen adgang' }, { status: 401 })

  const pins = await getPinsForUser(session.userId)
  return NextResponse.json({ pins })
}

export async function POST(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Ingen adgang' }, { status: 401 })

  const body = await req.json()
  const name = typeof body.name === 'string' ? body.name.trim() : ''
  const description = typeof body.description === 'string' ? body.description.trim().slice(0, 2000) : ''
  const latitude = Number(body.latitude)
  const longitude = Number(body.longitude)
  const rating = body.rating != null ? Number(body.rating) : 0
  const status = isPinStatus(body.status) ? body.status : 'vil_se'
  const icon = typeof body.icon === 'string' && PIN_ICON_OPTIONS.includes(body.icon) ? body.icon : '📍'
  const categoryId = typeof body.categoryId === 'string' && body.categoryId ? body.categoryId : null

  if (!name || name.length > 200) {
    return NextResponse.json({ error: 'Navn er påkrævet (maks 200 tegn)' }, { status: 400 })
  }
  if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90) {
    return NextResponse.json({ error: 'Ugyldig breddegrad' }, { status: 400 })
  }
  if (!Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
    return NextResponse.json({ error: 'Ugyldig længdegrad' }, { status: 400 })
  }
  if (!Number.isInteger(rating) || rating < 0 || rating > 3) {
    return NextResponse.json({ error: 'Rating skal være mellem 0 og 3' }, { status: 400 })
  }

  if (categoryId) {
    // Egen kategori eller en kategori delt med redigeringsret
    if (!(await canUseCategory(session.userId, categoryId))) {
      return NextResponse.json({ error: 'Ugyldig kategori' }, { status: 400 })
    }
  }

  const result = await pool.query(
    `INSERT INTO pins (user_id, name, description, latitude, longitude, location, rating, status, icon, category_id)
     VALUES ($1, $2, $3, $4, $5, ST_SetSRID(ST_MakePoint($5, $4), 4326)::geography, $6, $7, $8, $9)
     RETURNING id, name, description, latitude, longitude, rating, status, icon, category_id, created_at`,
    [session.userId, name, description, latitude, longitude, rating, status, icon, categoryId]
  )

  const row = result.rows[0]
  const category = categoryId
    ? (await pool.query('SELECT id, name, color FROM categories WHERE id = $1', [categoryId])).rows[0]
    : null

  return NextResponse.json({
    pin: mapPinRow({
      ...row,
      category_id: category?.id ?? null,
      category_name: category?.name ?? null,
      category_color: category?.color ?? null,
      images: [],
    }),
  })
}
