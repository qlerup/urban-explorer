import { NextRequest, NextResponse } from 'next/server'
import pool from '@/lib/db'
import { getSession } from '@/lib/auth'
import { getPinAccess } from '@/lib/access'
import { canUseCategory } from '@/lib/categories'
import { deletePinDir } from '@/lib/uploads'
import { isPinStatus, PIN_ICON_OPTIONS } from '@/types/pin'

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
  const hasCategory = 'categoryId' in body

  if (!hasRating && !hasName && !hasDescription && !hasStatus && !hasIcon && !hasCategory) {
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

  let description: string | undefined
  if (hasDescription) {
    description = body.description.trim().slice(0, 2000)
  }

  let status: string | undefined
  if (hasStatus) {
    if (!isPinStatus(body.status)) {
      return NextResponse.json({ error: 'Ugyldig status' }, { status: 400 })
    }
    status = body.status
  }

  let icon: string | undefined
  if (hasIcon) {
    if (!PIN_ICON_OPTIONS.includes(body.icon)) {
      return NextResponse.json({ error: 'Ugyldigt ikon' }, { status: 400 })
    }
    icon = body.icon
  }

  let categoryId: string | null | undefined
  let applyCategory = false
  if (hasCategory) {
    categoryId = typeof body.categoryId === 'string' && body.categoryId ? body.categoryId : null
    applyCategory = (categoryId ?? null) !== (access.categoryId ?? null)
    if (applyCategory) {
      // Kun pinnens ejer må flytte den til en anden kategori
      if (!access.isOwner) {
        return NextResponse.json({ error: 'Kun ejeren kan flytte pinnen til en anden kategori' }, { status: 403 })
      }
      if (categoryId && !(await canUseCategory(session.userId, categoryId))) {
        return NextResponse.json({ error: 'Ugyldig kategori' }, { status: 400 })
      }
    }
  }

  const result = await pool.query(
    `UPDATE pins SET
       rating = COALESCE($1, rating),
       name = COALESCE($2, name),
       description = COALESCE($3, description),
       status = COALESCE($4, status),
       icon = COALESCE($5, icon),
       category_id = CASE WHEN $6 THEN $7::uuid ELSE category_id END,
       updated_at = NOW()
     WHERE id = $8
     RETURNING id, name, description, rating, status, icon, category_id`,
    [rating ?? null, name ?? null, description ?? null, status ?? null, icon ?? null, applyCategory, categoryId ?? null, id]
  )

  if (result.rowCount === 0) return NextResponse.json({ error: 'Pin ikke fundet' }, { status: 404 })

  const row = result.rows[0]
  const category = row.category_id
    ? (await pool.query('SELECT id, name, color FROM categories WHERE id = $1', [row.category_id])).rows[0]
    : null

  return NextResponse.json({
    id: row.id,
    name: row.name,
    description: row.description ?? '',
    rating: row.rating,
    status: row.status,
    icon: row.icon,
    category,
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
