import { createWriteStream } from 'fs'
import { mkdir, open, readFile, rename, rm, stat } from 'fs/promises'
import path from 'path'
import { randomUUID } from 'crypto'
import { Readable } from 'stream'
import { pipeline } from 'stream/promises'
import sharp from 'sharp'

export const MAX_IMAGE_BYTES = 250 * 1024 * 1024
export const MAX_IMAGE_DIMENSION = 2560
export const OPTIMIZED_IMAGE_QUALITY = 82

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
  return null
}

function pinDir(pinId: string): string {
  // pinId er altid et UUID valideret af Postgres FK-opslag før dette kaldes
  return path.join(getUploadsRoot(), pinId)
}

export async function saveImage(pinId: string, file: File): Promise<{ filename: string; mimeType: string; sizeBytes: number } | null> {
  if (file.size === 0 || file.size > MAX_IMAGE_BYTES) return null

  const dir = pinDir(pinId)
  await mkdir(dir, { recursive: true })
  const id = randomUUID()
  const filename = `${id}.webp`
  const sourcePath = path.join(dir, `${id}.source.tmp`)
  const optimizedPath = path.join(dir, `${id}.optimized.tmp`)
  const finalPath = path.join(dir, filename)

  try {
    const source = Readable.fromWeb(file.stream() as unknown as import('stream/web').ReadableStream)
    await pipeline(source, createWriteStream(sourcePath, { flags: 'wx' }))

    const header = Buffer.alloc(12)
    const handle = await open(sourcePath, 'r')
    try {
      const { bytesRead } = await handle.read(header, 0, header.length, 0)
      if (!sniffImageMime(header.subarray(0, bytesRead))) return null
    } finally {
      await handle.close()
    }

    await sharp(sourcePath, { limitInputPixels: 120_000_000 })
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
    await rm(sourcePath, { force: true }).catch(() => {})
    await rm(optimizedPath, { force: true }).catch(() => {})
  }
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
