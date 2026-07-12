import { notFound } from 'next/navigation'
import { getShareScopeByToken } from '@/lib/shares'
import { getPinsByIds } from '@/lib/pins'
import { getMaptilerKey } from '@/lib/settings'
import PinsList from '@/components/PinsList'
import type { Category } from '@/types/pin'

export const dynamic = 'force-dynamic'

export default async function SharePinsPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const scope = await getShareScopeByToken(token)
  if (!scope) notFound()

  const [pins, maptilerKey] = await Promise.all([getPinsByIds(scope.userId, scope.pinIds), getMaptilerKey()])

  const categories: Category[] = Array.from(
    new Map(pins.flatMap(p => (p.category ? [[p.category.id, p.category] as const] : []))).values()
  )

  const sharedPins = pins.map(p => ({
    ...p,
    images: p.images.map(img => ({ ...img, url: `/api/share/${token}/images/${p.id}/${img.id}` })),
  }))

  return (
    <main>
      <div className="max-w-3xl mx-auto px-4 pt-6">
        <h1 className="text-xl font-bold text-gray-100">Mine pins</h1>
        <p className="text-sm text-gray-500 mt-0.5">{pins.length} gemte {pins.length === 1 ? 'sted' : 'steder'}</p>
      </div>
      <PinsList
        initialPins={sharedPins}
        categories={categories}
        maptilerKey={maptilerKey}
        readOnly
        kortHref={`/share/${token}/kort`}
      />
    </main>
  )
}
