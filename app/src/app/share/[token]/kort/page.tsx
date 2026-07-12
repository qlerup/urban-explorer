import { notFound } from 'next/navigation'
import { getShareScopeByToken } from '@/lib/shares'
import { getPinsByIds } from '@/lib/pins'
import { getMaptilerKey } from '@/lib/settings'
import MapView from '@/components/MapView'
import type { Category } from '@/types/pin'

export const dynamic = 'force-dynamic'

const PLACEHOLDER_KEY = 'indsaet_din_maptiler_key'

export default async function ShareKortPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>
  searchParams: Promise<{ pin?: string }>
}) {
  const { token } = await params
  const scope = await getShareScopeByToken(token)
  if (!scope) notFound()

  const maptilerKey = await getMaptilerKey()

  if (!maptilerKey || maptilerKey === PLACEHOLDER_KEY) {
    return (
      <div className="p-6 text-center text-gray-400 max-w-sm mx-auto pt-16">
        <p className="text-3xl mb-3">🗺️</p>
        <p className="font-semibold text-gray-200 mb-1">MapTiler-nøgle mangler</p>
        <p className="text-sm">Kortet kan ikke vise satellitbilleder lige nu.</p>
      </div>
    )
  }

  const [pins, { pin }] = await Promise.all([getPinsByIds(scope.userId, scope.pinIds), searchParams])

  const categories: Category[] = Array.from(
    new Map(pins.flatMap(p => (p.category ? [[p.category.id, p.category] as const] : []))).values()
  )

  const sharedPins = pins.map(p => ({
    ...p,
    images: p.images.map(img => ({ ...img, url: `/api/share/${token}/images/${p.id}/${img.id}` })),
  }))

  return <MapView maptilerKey={maptilerKey} initialPins={sharedPins} categories={categories} focusPinId={pin} readOnly />
}
