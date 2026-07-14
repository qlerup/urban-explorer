import { createReadStream } from 'fs'
import { stat } from 'fs/promises'
import { Readable } from 'stream'
import { NextResponse } from 'next/server'

function streamBody(path: string, start?: number, end?: number): BodyInit {
  const stream = createReadStream(path, start === undefined ? undefined : { start, end })
  return Readable.toWeb(stream) as unknown as BodyInit
}

export async function mediaFileResponse(req: Request, path: string, mimeType: string): Promise<NextResponse> {
  const file = await stat(path)
  const commonHeaders = {
    'Content-Type': mimeType,
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'private, max-age=86400',
  }
  const range = req.headers.get('range')
  if (!range) {
    return new NextResponse(streamBody(path), {
      headers: { ...commonHeaders, 'Content-Length': String(file.size) },
    })
  }

  const match = /^bytes=(\d*)-(\d*)$/.exec(range.trim())
  if (!match) {
    return new NextResponse(null, { status: 416, headers: { ...commonHeaders, 'Content-Range': `bytes */${file.size}` } })
  }

  let start: number
  let end: number
  if (!match[1]) {
    const suffixLength = Number(match[2])
    if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0) {
      return new NextResponse(null, { status: 416, headers: { ...commonHeaders, 'Content-Range': `bytes */${file.size}` } })
    }
    start = Math.max(0, file.size - suffixLength)
    end = file.size - 1
  } else {
    start = Number(match[1])
    end = match[2] ? Number(match[2]) : file.size - 1
  }

  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start >= file.size || end < start) {
    return new NextResponse(null, { status: 416, headers: { ...commonHeaders, 'Content-Range': `bytes */${file.size}` } })
  }
  end = Math.min(end, file.size - 1)

  return new NextResponse(streamBody(path, start, end), {
    status: 206,
    headers: {
      ...commonHeaders,
      'Content-Length': String(end - start + 1),
      'Content-Range': `bytes ${start}-${end}/${file.size}`,
    },
  })
}
