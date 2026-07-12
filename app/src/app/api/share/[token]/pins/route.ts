import { NextResponse } from 'next/server'
import { getShareScopeByToken } from '@/lib/shares'
import { getPinsByIds } from '@/lib/pins'

export async function GET(_req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const scope = await getShareScopeByToken(token)
  if (!scope) return NextResponse.json({ error: 'Ugyldigt link' }, { status: 404 })

  const pins = await getPinsByIds(scope.userId, scope.pinIds)
  const sharedPins = pins.map(pin => ({
    ...pin,
    images: pin.images.map(img => ({ ...img, url: `/api/share/${token}/images/${pin.id}/${img.id}` })),
  }))

  return NextResponse.json({ pins: sharedPins })
}
