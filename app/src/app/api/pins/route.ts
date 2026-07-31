import { NextRequest, NextResponse } from 'next/server'
import pool from '@/lib/db'
import { getSession } from '@/lib/auth'
import { getPinsForUser, mapPinRow } from '@/lib/pins'
import { isPinStatus, PIN_ICON_OPTIONS, VALID_PIN_ICONS } from '@/types/pin'

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
  const icon = typeof body.icon === 'string' && VALID_PIN_ICONS.includes(body.icon) ? body.icon : PIN_ICON_OPTIONS[0]
  const rawCategoryIds = Array.isArray(body.categoryIds)
    ? body.categoryIds
    : (typeof body.categoryId === 'string' && body.categoryId ? [body.categoryId] : [])
  const categoryIds = Array.from(new Set(rawCategoryIds.filter((id: unknown): id is string => typeof id === 'string' && id.length > 0)))
  const ownerId = typeof body.ownerId === 'string' && body.ownerId ? body.ownerId : session.userId
  const directShares = new Map<string, boolean>()
  if (ownerId === session.userId && Array.isArray(body.directShares)) {
    for (const item of body.directShares) {
      if (!item || typeof item !== 'object') continue
      const share = item as { userId?: unknown; canEdit?: unknown }
      if (typeof share.userId === 'string' && share.userId !== session.userId) {
        directShares.set(share.userId, share.canEdit === true)
      }
    }
  }

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

  if (directShares.size > 0) {
    const shareUsers = await pool.query(
      'SELECT id FROM users WHERE id = ANY($1::uuid[]) AND id != $2',
      [Array.from(directShares.keys()), session.userId]
    )
    if ((shareUsers.rowCount ?? 0) !== directShares.size) {
      return NextResponse.json({ error: 'En eller flere delingsbrugere er ugyldige' }, { status: 400 })
    }
  }

  if (ownerId === session.userId) {
    if (categoryIds.length > 0) {
      const ownCategories = await pool.query(
        'SELECT id FROM categories WHERE id = ANY($1::uuid[]) AND user_id = $2',
        [categoryIds, session.userId]
      )
      if ((ownCategories.rowCount ?? 0) !== categoryIds.length) {
        return NextResponse.json({ error: 'Ugyldig kategori' }, { status: 400 })
      }
    }
  } else if (categoryIds.length > 0) {
    const access = await pool.query(
      `SELECT c.id FROM categories c
       JOIN category_shares cs ON cs.category_id = c.id
       WHERE c.id = ANY($1::uuid[]) AND c.user_id = $2 AND cs.shared_with_id = $3 AND cs.can_edit`,
      [categoryIds, ownerId, session.userId]
    )
    if ((access.rowCount ?? 0) !== categoryIds.length) {
      return NextResponse.json({ error: 'Du kan ikke oprette pins i denne kategori' }, { status: 403 })
    }
  } else {
    const access = await pool.query(
      `SELECT 1 FROM uncategorized_pin_shares
       WHERE owner_id = $1 AND shared_with_id = $2 AND can_edit`,
      [ownerId, session.userId]
    )
    if ((access.rowCount ?? 0) === 0) {
      return NextResponse.json({ error: 'Du kan ikke oprette ukategoriserede pins her' }, { status: 403 })
    }
  }

  const client = await pool.connect()
  let row
  try {
    await client.query('BEGIN')
    const result = await client.query(
      `INSERT INTO pins (user_id, name, description, latitude, longitude, location, rating, status, icon, category_id)
       VALUES ($1, $2, $3, $4, $5, ST_SetSRID(ST_MakePoint($5, $4), 4326)::geography, $6, $7, $8, $9)
       RETURNING id, name, description, latitude, longitude, rating, status, icon, category_id, created_at`,
      [ownerId, name, description, latitude, longitude, rating, status, icon, categoryIds[0] ?? null]
    )
    row = result.rows[0]
    for (let position = 0; position < categoryIds.length; position += 1) {
      await client.query(
        'INSERT INTO pin_categories (pin_id, category_id, position) VALUES ($1, $2, $3)',
        [row.id, categoryIds[position], position]
      )
    }
    for (const [sharedWithId, canEdit] of directShares) {
      await client.query(
        'INSERT INTO pin_shares (pin_id, shared_with_id, can_edit) VALUES ($1, $2, $3)',
        [row.id, sharedWithId, canEdit]
      )
    }
    await client.query('COMMIT')
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }

  const selectedCategories = categoryIds.length > 0
    ? (await pool.query(
        `SELECT id, name, color
         FROM categories
         WHERE id = ANY($1::uuid[])
         ORDER BY array_position($1::uuid[], id)`,
        [categoryIds]
      )).rows
    : []
  const owner = ownerId !== session.userId
    ? (await pool.query('SELECT first_name FROM users WHERE id = $1', [ownerId])).rows[0]
    : null

  return NextResponse.json({
    pin: mapPinRow({
      ...row,
      categories: selectedCategories,
      category_id: selectedCategories[0]?.id ?? null,
      category_name: selectedCategories[0]?.name ?? null,
      category_color: selectedCategories[0]?.color ?? null,
      owner_id: ownerId !== session.userId ? ownerId : null,
      owner_first_name: owner?.first_name ?? null,
      can_edit: true,
      images: [],
    }),
  })
}
