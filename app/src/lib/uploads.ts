import { createWriteStream } from 'fs'
import { appendFile, mkdir, open, readFile, rename, rm, stat, writeFile } from 'fs/promises'
import path from 'path'
import { randomUUID } from 'crypto'
import { Readable } from 'stream'
import { pipeline } from 'stream/promises'
import sharp from 'sharp'

export const IMAGE_UPLOAD_CHUNK_BYTES = 2 * 1024 * 1024
export const MAX_IMAGE_DIMENSION = 2560
export const OPTIMIZED_IMAGE_QUALITY = 82

export interface ImageUploadSession {
  id: string
  pinId: string
  userId: string
  originalName: string
  totalBytes: number
  createdAt: string
}

function getUploadsRoot(): string {
  return process.env.UPLOADS_DIR || path.join(process.cwd(), 'uploads')
}

function chunkUploadsDir(): string {
  return path.join(getUploadsRoot(), '.chunked-uploads')
}

function validUploadId(uploadId: string): boolean {
  return /^[0-9a-f-]{36}$/i.test(uploadId)
}

function uploadPartPath(uploadId: string): string {
  if (!validUploadId(uploadId)) throw new Error('Ugyldigt upload-id')
  return path.join(chunkUploadsDir(), `${uploadId}.part`)
}

function uploadMetaPath(uploadId: string): string {
  if (!validUploadId(uploadId)) throw new Error('Ugyldigt upload-id')
  return path.join(chunkUploadsDir(), `${uploadId}.json`)
}

// Sniffer magic bytes i stedet for at stole på klientens Content-Type.
export function sniffImageMime(buffer: Buffer): string | null {
  if (buffer.length < 12) return null
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg'
  if (
    buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47 &&
    buffer[4] === 0x0d && buffer[5] === 0x0a && buffer[6] === 0x1a && buffer[7] === 0x0a
  ) return 'image/png'
  return null
}

function pinDir(pinId: string): string {
  return path.join(getUploadsRoot(), pinId)
}

async function optimizeImageSource(pinId: string, sourcePath: string): Promise<{ filename: string; mimeType: string; sizeBytes: number } | null> {
  const header = Buffer.alloc(12)
  const handle = await open(sourcePath, 'r')
  try {
    const { bytesRead } = await handle.read(header, 0, header.length, 0)
    if (!sniffImageMime(header.subarray(0, bytesRead))) return null
  } finally {
    await handle.close()
  }

  const dir = pinDir(pinId)
  await mkdir(dir, { recursive: true })
  const id = randomUUID()
  const filename = `${id}.webp`
  const optimizedPath = path.join(dir, `${id}.optimized.tmp`)
  const finalPath = path.join(dir, filename)

  try {
    await sharp(sourcePath, { limitInputPixels: false, sequentialRead: true })
      .rotate()
      .resize({
        width: MAX_IMAGE_DIMENSION,
        height: MAX_IMAGE_DIMENSION,
        fit: 'inside',
        withoutEnlargement: true,
      })
      .webp({
        quality: OPTIMIZED_IMAGE_QUALITY,
        alphaQuality: 90,
        effort: 5,
        smartSubsample: true,
      })
      .toFile(optimizedPath)

    const optimizedStat = await stat(optimizedPath)
    if (optimizedStat.size <= 0) return null
    await rename(optimizedPath, finalPath)
    return { filename, mimeType: 'image/webp', sizeBytes: optimizedStat.size }
  } catch {
    return null
  } finally {
    await rm(optimizedPath, { force: true }).catch(() => {})
  }
}

export async function saveImage(pinId: string, file: File): Promise<{ filename: string; mimeType: string; sizeBytes: number } | null> {
  if (file.size === 0) return null

  const dir = pinDir(pinId)
  await mkdir(dir, { recursive: true })
  const sourcePath = path.join(dir, `${randomUUID()}.source.tmp`)

  try {
    const source = Readable.fromWeb(file.stream() as unknown as import('stream/web').ReadableStream)
    await pipeline(source, createWriteStream(sourcePath, { flags: 'wx' }))
    return await optimizeImageSource(pinId, sourcePath)
  } finally {
    await rm(sourcePath, { force: true }).catch(() => {})
  }
}

export async function createImageUploadSession(pinId: string, userId: string, originalName: string, totalBytes: number): Promise<ImageUploadSession> {
  if (!Number.isSafeInteger(totalBytes) || totalBytes <= 0) throw new Error('Ugyldig filstørrelse')
  const session: ImageUploadSession = {
    id: randomUUID(),
    pinId,
    userId,
    originalName: originalName.slice(0, 255),
    totalBytes,
    createdAt: new Date().toISOString(),
  }
  await mkdir(chunkUploadsDir(), { recursive: true })
  await writeFile(uploadPartPath(session.id), Buffer.alloc(0), { flag: 'wx' })
  try {
    await writeFile(uploadMetaPath(session.id), JSON.stringify(session), { flag: 'wx' })
  } catch (error) {
    await rm(uploadPartPath(session.id), { force: true }).catch(() => {})
    throw error
  }
  return session
}

export async function getImageUploadSession(uploadId: string): Promise<(ImageUploadSession & { offset: number }) | null> {
  try {
    const session = JSON.parse(await readFile(uploadMetaPath(uploadId), 'utf8')) as ImageUploadSession
    const partStat = await stat(uploadPartPath(uploadId))
    return { ...session, offset: partStat.size }
  } catch {
    return null
  }
}

export async function appendImageUploadChunk(uploadId: string, expectedOffset: number, chunk: Buffer): Promise<number> {
  const session = await getImageUploadSession(uploadId)
  if (!session) throw new Error('Upload ikke fundet')
  if (expectedOffset !== session.offset) throw new Error('Forkert upload-position')
  if (chunk.length === 0 || chunk.length > IMAGE_UPLOAD_CHUNK_BYTES) throw new Error('Ugyldig upload-del')
  if (session.offset + chunk.length > session.totalBytes) throw new Error('Upload-del overskrider filstørrelsen')
  await appendFile(uploadPartPath(uploadId), chunk)
  return session.offset + chunk.length
}

export async function finishImageUpload(uploadId: string): Promise<{ session: ImageUploadSession; saved: { filename: string; mimeType: string; sizeBytes: number } | null }> {
  const session = await getImageUploadSession(uploadId)
  if (!session || session.offset !== session.totalBytes) throw new Error('Upload er ikke færdig')
  try {
    const saved = await optimizeImageSource(session.pinId, uploadPartPath(uploadId))
    return { session, saved }
  } finally {
    await removeImageUploadSession(uploadId)
  }
}

export async function removeImageUploadSession(uploadId: string): Promise<void> {
  await rm(uploadPartPath(uploadId), { force: true }).catch(() => {})
  await rm(uploadMetaPath(uploadId), { force: true }).catch(() => {})
}

export async function readImage(pinId: string, filename: string): Promise<Buffer> {
  return readFile(path.join(pinDir(pinId), filename))
}

export async function deleteImage(pinId: string, filename: string): Promise<void> {
  await rm(path.join(pinDir(pinId), filename), { force: true })
}

export async function deletePinDir(pinId: string): Promise<void> {
  await rm(pinDir(pinId), { recursive: true, force: true })
}
