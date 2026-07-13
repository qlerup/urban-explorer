import { NextRequest, NextResponse } from 'next/server'
import pool from '@/lib/db'
import { getSession } from '@/lib/auth'
import { getPinAccess } from '@/lib/access'
import {
  appendImageUploadChunk,
  deleteImage,
  finishImageUpload,
  getImageUploadSession,
  IMAGE_UPLOAD_CHUNK_BYTES,
  removeImageUploadSession,
} from '@/lib/uploads'

export const runtime = 'nodejs'

type RouteParams = { params: Promise<{ id: string; uploadId: string }> }

async function authorize(id: string, uploadId: string) {
  const session = await getSession()
  if (!session) return { response: NextResponse.json({ error: 'Ingen adgang' }, { status: 401 }) }
  const upload = await getImageUploadSession(uploadId)
  if (!upload || upload.pinId !== id || upload.userId !== session.userId) {
    return { response: NextResponse.json({ error: 'Upload ikke fundet' }, { status: 404 }) }
  }
  const access = await getPinAccess(id, session.userId)
  if (!access) return { response: NextResponse.json({ error: 'Pin ikke fundet' }, { status: 404 }) }
  if (!access.canEdit) return { response: NextResponse.json({ error: 'Du har kun læseadgang til denne pin' }, { status: 403 }) }
  return { upload }
}

async function readChunk(req: NextRequest): Promise<Buffer> {
  if (!req.body) return Buffer.alloc(0)
  const reader = req.body.getReader()
  const parts: Buffer[] = []
  let total = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > IMAGE_UPLOAD_CHUNK_BYTES) {
      await reader.cancel().catch(() => {})
      throw new Error('Upload-delen er for stor')
    }
    parts.push(Buffer.from(value))
  }
  return Buffer.concat(parts, total)
}

export async function HEAD(_req: NextRequest, { params }: RouteParams) {
  const { id, uploadId } = await params
  const auth = await authorize(id, uploadId)
  if ('response' in auth) return auth.response
  return new NextResponse(null, {
    status: 204,
    headers: {
      'Upload-Offset': String(auth.upload.offset),
      'Upload-Length': String(auth.upload.totalBytes),
      'Cache-Control': 'no-store',
    },
  })
}

export async function POST(req: NextRequest, { params }: RouteParams) {
  const { id, uploadId } = await params
  const auth = await authorize(id, uploadId)
  if ('response' in auth) return auth.response

  const expectedOffset = Number(req.headers.get('upload-offset'))
  if (!Number.isSafeInteger(expectedOffset) || expectedOffset < 0) {
    return NextResponse.json({ error: 'Ugyldig upload-position', offset: auth.upload.offset }, { status: 400 })
  }
  if (expectedOffset !== auth.upload.offset) {
    return NextResponse.json({ error: 'Upload-positionen er ændret', offset: auth.upload.offset }, { status: 409 })
  }

  let chunk: Buffer
  try {
    chunk = await readChunk(req)
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Ugyldig upload-del' }, { status: 413 })
  }

  let offset: number
  try {
    offset = await appendImageUploadChunk(uploadId, expectedOffset, chunk)
  } catch (error) {
    const current = await getImageUploadSession(uploadId)
    return NextResponse.json({
      error: error instanceof Error ? error.message : 'Upload-delen kunne ikke gemmes',
      offset: current?.offset ?? expectedOffset,
    }, { status: 409 })
  }

  if (offset < auth.upload.totalBytes) {
    return NextResponse.json({ offset, complete: false })
  }

  const completed = await finishImageUpload(uploadId)
  if (!completed.saved) {
    return NextResponse.json({ error: 'Billedet kunne ikke behandles. Kun gyldige JPG-, JPEG- og PNG-filer er tilladt.' }, { status: 400 })
  }

  try {
    const result = await pool.query(
      `INSERT INTO pin_images (pin_id, filename, original_name, mime_type, size_bytes)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id`,
      [id, completed.saved.filename, completed.session.originalName, completed.saved.mimeType, completed.saved.sizeBytes]
    )
    return NextResponse.json({
      offset,
      complete: true,
      image: {
        id: result.rows[0].id,
        originalName: completed.session.originalName,
        url: `/api/pins/${id}/images/${result.rows[0].id}`,
      },
    })
  } catch {
    await deleteImage(id, completed.saved.filename)
    return NextResponse.json({ error: 'Billedet blev behandlet, men kunne ikke gemmes' }, { status: 500 })
  }
}

export async function DELETE(_req: NextRequest, { params }: RouteParams) {
  const { id, uploadId } = await params
  const auth = await authorize(id, uploadId)
  if ('response' in auth) return auth.response
  await removeImageUploadSession(uploadId)
  return new NextResponse(null, { status: 204 })
}
