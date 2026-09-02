import { redirect } from 'next/navigation'
import Link from 'next/link'
import { getSession } from '@/lib/auth'
import { getPinsForUser } from '@/lib/pins'
import { getCategoriesForUser, getCategoriesSharedWithUser } from '@/lib/categories'
import { getMaptilerKey, getMapProvider } from '@/lib/settings'
import { getSavedRouteForUser } from '@/lib/savedRoutes'
import RoutePlannerShell from '@/components/RoutePlannerShell'

export const dynamic = 'force-dynamic'

const PLACEHOLDER_KEY = 'indsaet_din_maptiler_key'

export default async function RoutePlannerPage({
  searchParams,
}: {
  searchParams: Promise<{ rute?: string }>
}) {
  const session = await getSession()
  if (!session) redirect('/login')

  const { rute } = await searchParams
  const [maptilerKey, mapProvider, pins, categories, sharedCategories, savedRoute] = await Promise.all([
    getMaptilerKey(),
    getMapProvider(),
    getPinsForUser(session.userId),
    getCategoriesForUser(session.userId),
    getCategoriesSharedWithUser(session.userId),
    rute ? getSavedRouteForUser(session.userId, rute) : Promise.resolve(null),
  ])

  if (mapProvider === 'maptiler' && (!maptilerKey || maptilerKey === PLACEHOLDER_KEY)) {
    return (
      <div className="mx-auto max-w-sm p-6 pt-16 text-center text-gray-400">
        <p className="mb-3 text-3xl">🗺️</p>
        <p className="mb-1 font-semibold text-gray-200">MapTiler-nøgle mangler</p>
        <p className="mb-4 text-sm">Ruteplanlæggeren følger kortudbyderen fra Indstillinger og kræver derfor en gyldig MapTiler-nøgle, når MapTiler er valgt.</p>
        {session.isAdmin ? (
          <Link href="/dashboard/indstillinger" className="btn-primary inline-block">
            Gå til indstillinger
          </Link>
        ) : (
          <p className="text-xs text-gray-500">Kontakt en administrator.</p>
        )}
      </div>
    )
  }

  return (
    <RoutePlannerShell
      maptilerKey={maptilerKey ?? ''}
      mapProvider={mapProvider}
      geodanmarkAvailable={false}
      initialPins={pins}
      categories={[...categories, ...sharedCategories]}
      initialSavedRoute={savedRoute ? {
        id: savedRoute.id,
        name: savedRoute.name,
        routeData: savedRoute.routeData,
      } : null}
    />
  )
}
