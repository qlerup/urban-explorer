import { mkdir, readFile, rm, writeFile } from 'fs/promises'
import path from 'path'
import { randomUUID } from 'crypto'

export const MAX_IMAGE_BYTES = 8 * 1024 * 1024

const EXT_BY_MIME: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
}

function getUploadsRoot(): string {
  return process.env.UPLOADS_DIR || path.join(process.cwd(), 'uploads')
}

// Sniffer magic bytes i stedet for at stole på klientens Content-Type
export function sniffImageMime(buffer: Buffer): string | null {
  if (buffer.length < 12) return null
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg'
  if (
    buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47 &&
    buffer[4] === 0x0d && buffer[5] === 0x0a && buffer[6] === 0x1a && buffer[7] === 0x0a
  ) return 'image/png'
  if (
    buffer[0] === 0x52 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x46 &&
    buffer[8] === 0x57 && buffer[9] === 0x45 && buffer[10] === 0x42 && buffer[11] === 0x50
  ) return 'image/webp'
  return null
}

function pinDir(pinId: string): string {
  // pinId er altid et UUID valideret af Postgres FK-opslag før dette kaldes
  return path.join(getUploadsRoot(), pinId)
}

export async function saveImage(pinId: string, buffer: Buffer): Promise<{ filename: string; mimeType: string; sizeBytes: number } | null> {
  if (buffer.length === 0 || buffer.length > MAX_IMAGE_BYTES) return null
  const mimeType = sniffImageMime(buffer)
  if (!mimeType) return null

  const dir = pinDir(pinId)
  await mkdir(dir, { recursive: true })
  const filename = `${randomUUID()}.${EXT_BY_MIME[mimeType]}`
  await writeFile(path.join(dir, filename), buffer)

  return { filename, mimeType, sizeBytes: buffer.length }
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
