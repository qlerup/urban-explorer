import { NextRequest, NextResponse } from 'next/server'
import pool from '@/lib/db'
import { getSession } from '@/lib/auth'
import { getPinAccess } from '@/lib/access'
import { deleteImage, readImage } from '@/lib/uploads'

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string; imageId: string }> }) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Ingen adgang' }, { status: 401 })

  const { id, imageId } = await params

  // Læseadgang rækker: egne pins, delte pins og samarbejdspins i egne kategorier
  const access = await getPinAccess(id, session.userId).catch(() => null)
  if (!access) return NextResponse.json({ error: 'Billede ikke fundet' }, { status: 404 })

  const result = await pool.query(
    `SELECT i.filename, i.mime_type
     FROM pin_images i
     WHERE i.id = $1 AND i.pin_id = $2`,
    [imageId, id]
  ).catch(() => ({ rows: [] as { filename: string; mime_type: string }[] }))

  const row = result.rows[0]
  if (!row) return NextResponse.json({ error: 'Billede ikke fundet' }, { status: 404 })

  try {
    const buffer = await readImage(id, row.filename)
    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        'Content-Type': row.mime_type,
        'Cache-Control': 'private, max-age=86400',
      },
    })
  } catch {
    return NextResponse.json({ error: 'Billede ikke fundet' }, { status: 404 })
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string; imageId: string }> }) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Ingen adgang' }, { status: 401 })

  const { id, imageId } = await params

  const access = await getPinAccess(id, session.userId).catch(() => null)
  if (!access) return NextResponse.json({ error: 'Billede ikke fundet' }, { status: 404 })
  if (!access.canEdit) return NextResponse.json({ error: 'Du har kun læseadgang til denne pin' }, { status: 403 })

  const result = await pool.query(
    `DELETE FROM pin_images i
     WHERE i.id = $1 AND i.pin_id = $2
     RETURNING i.filename`,
    [imageId, id]
  ).catch(() => ({ rows: [] as { filename: string }[], rowCount: 0 }))

  if (result.rowCount === 0 || !result.rows[0]) {
    return NextResponse.json({ error: 'Billede ikke fundet' }, { status: 404 })
  }

  await deleteImage(id, result.rows[0].filename)

  return NextResponse.json({ success: true })
}
