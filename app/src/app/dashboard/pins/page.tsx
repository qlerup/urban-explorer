import { redirect } from 'next/navigation'
import { getSession } from '@/lib/auth'
import { getPinsForUser } from '@/lib/pins'
import { getCategoriesForUser, getCategoriesSharedWithUser } from '@/lib/categories'
import { getMaptilerKey } from '@/lib/settings'
import PinsList from '@/components/PinsList'

export const dynamic = 'force-dynamic'

export default async function PinsPage() {
  const session = await getSession()
  if (!session) redirect('/login')

  const [pins, categories, sharedCategories, maptilerKey] = await Promise.all([
    getPinsForUser(session.userId),
    getCategoriesForUser(session.userId),
    getCategoriesSharedWithUser(session.userId),
    getMaptilerKey(),
  ])

  return (
    <main>
      <div className="max-w-3xl mx-auto px-4 pt-6 flex items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-gray-100">Mine pins</h1>
          <p className="text-sm text-gray-500 mt-0.5">{pins.length} gemte {pins.length === 1 ? 'sted' : 'steder'}</p>
        </div>
        {pins.length > 0 && (
          <a href="/api/export" download className="btn-secondary text-xs py-2 px-3 shrink-0">
            ⬇️ Eksportér KMZ
          </a>
        )}
      </div>
      <PinsList initialPins={pins} categories={[...categories, ...sharedCategories]} maptilerKey={maptilerKey} />
    </main>
  )
}
