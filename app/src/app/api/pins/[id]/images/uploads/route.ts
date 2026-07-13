import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { getPinAccess } from '@/lib/access'
import { createImageUploadSession, IMAGE_UPLOAD_CHUNK_BYTES } from '@/lib/uploads'

export const runtime = 'nodejs'

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Ingen adgang' }, { status: 401 })

  const { id } = await params
  const access = await getPinAccess(id, session.userId)
  if (!access) return NextResponse.json({ error: 'Pin ikke fundet' }, { status: 404 })
  if (!access.canEdit) return NextResponse.json({ error: 'Du har kun læseadgang til denne pin' }, { status: 403 })

  const body = await req.json().catch(() => null) as { filename?: unknown; size?: unknown } | null
  const filename = typeof body?.filename === 'string' ? body.filename.trim() : ''
  const size = typeof body?.size === 'number' ? body.size : NaN
  const extension = filename.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] ?? ''

  if (!filename || !['jpg', 'jpeg', 'png'].includes(extension)) {
    return NextResponse.json({ error: 'Kun JPG, JPEG og PNG kan uploades.' }, { status: 400 })
  }
  if (!Number.isSafeInteger(size) || size <= 0) {
    return NextResponse.json({ error: 'Ugyldig filstørrelse' }, { status: 400 })
  }

  const upload = await createImageUploadSession(id, session.userId, filename, size)
  return NextResponse.json({ uploadId: upload.id, offset: 0, chunkSize: IMAGE_UPLOAD_CHUNK_BYTES }, { status: 201 })
}
