import { NextResponse } from 'next/server'
import pool from '@/lib/db'
import { getShareScopeByToken } from '@/lib/shares'
import { getMediaPath } from '@/lib/uploads'
import { mediaFileResponse } from '@/lib/media-response'

export async function GET(
  req: Request,
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
  if (!row) return NextResponse.json({ error: 'Mediefil ikke fundet' }, { status: 404 })

  try {
    return await mediaFileResponse(req, getMediaPath(pinId, row.filename), row.mime_type)
  } catch {
    return NextResponse.json({ error: 'Mediefil ikke fundet' }, { status: 404 })
  }
}
