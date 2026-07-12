import { NextResponse } from 'next/server'
import pool from '@/lib/db'
import { getShareScopeByToken } from '@/lib/shares'
import { readImage } from '@/lib/uploads'

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ token: string; pinId: string; imageId: string }> }
) {
  const { token, pinId, imageId } = await params
  const scope = await getShareScopeByToken(token)
  if (!scope || !scope.pinIds.includes(pinId)) return NextResponse.json({ error: 'Ugyldigt link' }, { status: 404 })

  const result = await pool.query(
    `SELECT i.filename, i.mime_type
     FROM pin_images i
     JOIN pins p ON p.id = i.pin_id
     WHERE i.id = $1 AND i.pin_id = $2 AND p.user_id = $3`,
    [imageId, pinId, scope.userId]
  ).catch(() => ({ rows: [] as { filename: string; mime_type: string }[] }))

  const row = result.rows[0]
  if (!row) return NextResponse.json({ error: 'Billede ikke fundet' }, { status: 404 })

  try {
    const buffer = await readImage(pinId, row.filename)
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
