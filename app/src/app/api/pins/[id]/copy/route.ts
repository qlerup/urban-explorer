import { NextRequest, NextResponse } from 'next/server'
import pool from '@/lib/db'
import { getSession } from '@/lib/auth'
import { getPinAccess } from '@/lib/access'
import { getPinsByIds } from '@/lib/pins'
import { copyMediaFile, deletePinDir } from '@/lib/uploads'

interface SourceImage {
  filename: string
  original_name: string
  mime_type: string
  size_bytes: string
}

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Ingen adgang' }, { status: 401 })

  const { id: sourcePinId } = await params
  const access = await getPinAccess(sourcePinId, session.userId).catch(() => null)
  if (!access) return NextResponse.json({ error: 'Pin ikke fundet' }, { status: 404 })
  if (access.isOwner) return NextResponse.json({ error: 'Pinnen ligger allerede på dit eget kort' }, { status: 400 })

  const client = await pool.connect()
  let targetPinId: string | null = null
  try {
    await client.query('BEGIN')
    const sourceResult = await client.query(
      `SELECT name, description, latitude, longitude, rating, status, icon
       FROM pins WHERE id = $1 FOR SHARE`,
      [sourcePinId]
    )
    const source = sourceResult.rows[0]
    if (!source) {
      await client.query('ROLLBACK')
      return NextResponse.json({ error: 'Pin ikke fundet' }, { status: 404 })
    }

    const inserted = await client.query(
      `INSERT INTO pins (user_id, name, description, latitude, longitude, location, rating, status, icon)
       VALUES ($1, $2, $3, $4, $5, ST_SetSRID(ST_MakePoint($5, $4), 4326)::geography, $6, $7, $8)
       RETURNING id`,
      [session.userId, source.name, source.description, source.latitude, source.longitude, source.rating, source.status, source.icon]
    )
    targetPinId = inserted.rows[0].id

    const sourceCategories = await client.query(
      `SELECT c.name, c.color
       FROM pin_categories pc
       JOIN categories c ON c.id = pc.category_id
       WHERE pc.pin_id = $1
       ORDER BY pc.position, c.name`,
      [sourcePinId]
    )
    for (let position = 0; position < sourceCategories.rows.length; position += 1) {
      const category = sourceCategories.rows[position]
      const categoryResult = await client.query(
        `INSERT INTO categories (user_id, name, color)
         VALUES ($1, $2, $3)
         ON CONFLICT (user_id, name) DO UPDATE SET name = EXCLUDED.name
         RETURNING id`,
        [session.userId, category.name, category.color]
      )
      await client.query(
        'INSERT INTO pin_categories (pin_id, category_id, position) VALUES ($1, $2, $3)',
        [targetPinId, categoryResult.rows[0].id, position]
      )
    }

    await client.query(
      `INSERT INTO pin_routes (pin_id, name, points, distance_meters)
       SELECT $1, name, points, distance_meters FROM pin_routes WHERE pin_id = $2`,
      [targetPinId, sourcePinId]
    )

    const images = await client.query<SourceImage>(
      `SELECT filename, original_name, mime_type, size_bytes
       FROM pin_images WHERE pin_id = $1 ORDER BY created_at`,
      [sourcePinId]
    )
    for (const image of images.rows) {
      await copyMediaFile(sourcePinId, targetPinId!, image.filename)
      await client.query(
        `INSERT INTO pin_images (pin_id, filename, original_name, mime_type, size_bytes)
         VALUES ($1, $2, $3, $4, $5)`,
        [targetPinId, image.filename, image.original_name, image.mime_type, image.size_bytes]
      )
    }

    await client.query('COMMIT')
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {})
    if (targetPinId) await deletePinDir(targetPinId).catch(() => {})
    console.error('[pin-copy] Kunne ikke kopiere delt pin:', error)
    return NextResponse.json({ error: 'Kunne ikke gemme pinnen på dit eget kort' }, { status: 500 })
  } finally {
    client.release()
  }

  const [pin] = await getPinsByIds(session.userId, [targetPinId!])
  return NextResponse.json({ pin })
}
