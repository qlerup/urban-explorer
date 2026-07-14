import { NextRequest, NextResponse } from 'next/server'
import pool from '@/lib/db'
import { getSession } from '@/lib/auth'
import { getPinAccess } from '@/lib/access'
import { isAllowedMediaFilename, saveImage } from '@/lib/uploads'

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Ingen adgang' }, { status: 401 })

  const { id } = await params

  const access = await getPinAccess(id, session.userId)
  if (!access) return NextResponse.json({ error: 'Pin ikke fundet' }, { status: 404 })
  if (!access.canEdit) return NextResponse.json({ error: 'Du har kun læseadgang til denne pin' }, { status: 403 })

  const formData = await req.formData().catch(() => null)
  const file = formData?.get('file')
  if (!file || !(file instanceof File)) {
    return NextResponse.json({ error: 'Ingen fil modtaget' }, { status: 400 })
  }

  if (!isAllowedMediaFilename(file.name)) {
    return NextResponse.json({ error: 'Filtypen understøttes ikke. Brug JPG, JPEG, PNG eller en almindelig videofil.' }, { status: 400 })
  }

  const saved = await saveImage(id, file)
  if (!saved) {
    return NextResponse.json({ error: 'Mediefilen kunne ikke behandles eller matchede ikke filtypen.' }, { status: 400 })
  }

  const result = await pool.query(
    `INSERT INTO pin_images (pin_id, filename, original_name, mime_type, size_bytes)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id`,
    [id, saved.filename, file.name.slice(0, 255), saved.mimeType, saved.sizeBytes]
  )

  return NextResponse.json({
    image: { id: result.rows[0].id, originalName: file.name, mimeType: saved.mimeType, url: `/api/pins/${id}/images/${result.rows[0].id}` },
  })
}
