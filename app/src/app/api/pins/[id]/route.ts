import { NextRequest, NextResponse } from 'next/server'
import pool from '@/lib/db'
import { getSession } from '@/lib/auth'
import { getPinAccess } from '@/lib/access'
import { canUseCategory } from '@/lib/categories'
import { deletePinDir } from '@/lib/uploads'
import { isPinStatus, VALID_PIN_ICONS } from '@/types/pin'

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Ingen adgang' }, { status: 401 })

  const { id } = await params
  const access = await getPinAccess(id, session.userId)
  if (!access) return NextResponse.json({ error: 'Pin ikke fundet' }, { status: 404 })
  if (!access.canEdit) return NextResponse.json({ error: 'Du har kun læseadgang til denne pin' }, { status: 403 })

  const body = await req.json()
  const hasRating = body.rating != null
  const hasName = typeof body.name === 'string'
  const hasDescription = typeof body.description === 'string'
  const hasStatus = body.status != null
  const hasIcon = typeof body.icon === 'string'
  const hasCategories = 'categoryIds' in body || 'categoryId' in body

  if (!hasRating && !hasName && !hasDescription && !hasStatus && !hasIcon && !hasCategories) {
    return NextResponse.json({ error: 'Intet at opdatere' }, { status: 400 })
  }

  let rating: number | undefined
  if (hasRating) {
    rating = Number(body.rating)
    if (!Number.isInteger(rating) || rating < 0 || rating > 3) {
      return NextResponse.json({ error: 'Rating skal være mellem 0 og 3' }, { status: 400 })
    }
  }

  let name: string | undefined
  if (hasName) {
    name = body.name.trim()
    if (!name || name.length > 200) {
      return NextResponse.json({ error: 'Navn er påkrævet (maks 200 tegn)' }, { status: 400 })
    }
  }

  const description = hasDescription ? body.description.trim().slice(0, 2000) : undefined

  let status: string | undefined
  if (hasStatus) {
    if (!isPinStatus(body.status)) {
      return NextResponse.json({ error: 'Ugyldig status' }, { status: 400 })
    }
    status = body.status
  }

  let icon: string | undefined
  if (hasIcon) {
    if (!VALID_PIN_ICONS.includes(body.icon)) {
      return NextResponse.json({ error: 'Ugyldigt ikon' }, { status: 400 })
    }
    icon = body.icon
  }

  let categoryIds: string[] | undefined
  let applyCategories = false
  if (hasCategories) {
    const rawCategoryIds = Array.isArray(body.categoryIds)
      ? body.categoryIds
      : (typeof body.categoryId === 'string' && body.categoryId ? [body.categoryId] : [])
    categoryIds = Array.from(new Set(rawCategoryIds.filter((categoryId: unknown): categoryId is string =>
      typeof categoryId === 'string' && categoryId.length > 0
    )))
    applyCategories =
      categoryIds.length !== access.categoryIds.length
      || categoryIds.some((categoryId, index) => categoryId !== access.categoryIds[index])

    if (applyCategories) {
      if (!access.isOwner) {
        return NextResponse.json({ error: 'Kun ejeren kan ændre pinnens kategorier' }, { status: 403 })
      }
      for (const categoryId of categoryIds) {
        if (!(await canUseCategory(session.userId, categoryId))) {
          return NextResponse.json({ error: 'Ugyldig kategori' }, { status: 400 })
        }
      }
    }
  }

  const client = await pool.connect()
  let row
  try {
    await client.query('BEGIN')
    const result = await client.query(
      `UPDATE pins SET
         rating = COALESCE($1, rating),
         name = COALESCE($2, name),
         description = COALESCE($3, description),
         status = COALESCE($4, status),
         icon = COALESCE($5, icon),
         category_id = CASE WHEN $6 THEN $7::uuid ELSE category_id END,
         updated_at = NOW()
       WHERE id = $8
       RETURNING id, name, description, rating, status, icon`,
      [rating ?? null, name ?? null, description ?? null, status ?? null, icon ?? null, applyCategories, categoryIds?.[0] ?? null, id]
    )
    if (result.rowCount === 0) {
      await client.query('ROLLBACK')
      return NextResponse.json({ error: 'Pin ikke fundet' }, { status: 404 })
    }
    row = result.rows[0]

    if (applyCategories && categoryIds) {
      await client.query('DELETE FROM pin_categories WHERE pin_id = $1', [id])
      for (let position = 0; position < categoryIds.length; position += 1) {
        await client.query(
          'INSERT INTO pin_categories (pin_id, category_id, position) VALUES ($1, $2, $3)',
          [id, categoryIds[position], position]
        )
      }
    }
    await client.query('COMMIT')
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }

  const selectedCategories = (await pool.query(
    `SELECT c.id, c.name, c.color
     FROM pin_categories pc
     JOIN categories c ON c.id = pc.category_id
     WHERE pc.pin_id = $1
     ORDER BY pc.position, c.name`,
    [id]
  )).rows

  return NextResponse.json({
    id: row.id,
    name: row.name,
    description: row.description ?? '',
    rating: row.rating,
    status: row.status,
    icon: row.icon,
    categories: selectedCategories,
    category: selectedCategories[0] ?? null,
  })
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Ingen adgang' }, { status: 401 })

  const { id } = await params
  const result = await pool.query(
    'DELETE FROM pins WHERE id = $1 AND user_id = $2 RETURNING id',
    [id, session.userId]
  )

  if (result.rowCount === 0) return NextResponse.json({ error: 'Pin ikke fundet' }, { status: 404 })

  await deletePinDir(id)
  return NextResponse.json({ success: true })
}
