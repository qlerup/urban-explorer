import { redirect } from 'next/navigation'
import Link from 'next/link'
import { getSession } from '@/lib/auth'
import { getPinsForUser } from '@/lib/pins'
import { getCategoriesForUser, getCategoriesSharedWithUser, getSharedWorkspacesForUser } from '@/lib/categories'
import { getGridCellsForUser } from '@/lib/grid'
import { getMaptilerKey } from '@/lib/settings'
import MapView from '@/components/MapView'

export const dynamic = 'force-dynamic'

const PLACEHOLDER_KEY = 'indsaet_din_maptiler_key'

export default async function KortPage({ searchParams }: { searchParams: Promise<{ pin?: string }> }) {
  const session = await getSession()
  if (!session) redirect('/login')

  const maptilerKey = await getMaptilerKey()

  if (!maptilerKey || maptilerKey === PLACEHOLDER_KEY) {
    return (
      <div className="p-6 text-center text-gray-400 max-w-sm mx-auto pt-16">
        <p className="text-3xl mb-3">🗺️</p>
        <p className="font-semibold text-gray-200 mb-1">MapTiler-nøgle mangler</p>
        <p className="text-sm mb-4">Kortet kan ikke vise satellitbilleder før en gyldig MapTiler API-nøgle er sat.</p>
        {session.isAdmin ? (
          <Link href="/dashboard/indstillinger" className="btn-primary inline-block">
            Gå til indstillinger
          </Link>
        ) : (
          <p className="text-xs text-gray-500">Kontakt en administrator for at få sat nøglen op.</p>
        )}
      </div>
    )
  }

  const [pins, categories, sharedCategories, sharedWorkspaces, gridCells, { pin }] = await Promise.all([
    getPinsForUser(session.userId),
    getCategoriesForUser(session.userId),
    getCategoriesSharedWithUser(session.userId),
    getSharedWorkspacesForUser(session.userId),
    getGridCellsForUser(session.userId),
    searchParams,
  ])

  return (
    <MapView
      maptilerKey={maptilerKey}
      initialPins={pins}
      categories={[...categories, ...sharedCategories]}
      sharedWorkspaces={sharedWorkspaces}
      initialGridCells={gridCells}
      focusPinId={pin}
    />
  )
}
