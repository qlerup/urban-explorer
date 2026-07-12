import { redirect } from 'next/navigation'
import { headers } from 'next/headers'
import { getSession } from '@/lib/auth'
import { getCategoriesForUser } from '@/lib/categories'
import { getPinsForUser } from '@/lib/pins'
import { getShareLinksForUser } from '@/lib/shares'
import ShareLinksManager from '@/components/ShareLinksManager'

export const dynamic = 'force-dynamic'

export default async function DelteLinksPage() {
  const session = await getSession()
  if (!session) redirect('/login')

  const [shares, pins, categories, headerList] = await Promise.all([
    getShareLinksForUser(session.userId),
    getPinsForUser(session.userId),
    getCategoriesForUser(session.userId),
    headers(),
  ])
  // Bag en reverse proxy (fx på Proxmox) sætter proxy'en typisk X-Forwarded-Host/-Proto til det
  // rigtige offentlige domæne. Dem bruger vi hvis de findes, ellers falder vi tilbage til Host-headeren.
  const host = headerList.get('x-forwarded-host') ?? headerList.get('host') ?? 'localhost'
  const protocol = headerList.get('x-forwarded-proto') ?? (host.startsWith('localhost') || host.startsWith('127.0.0.1') ? 'http' : 'https')
  const origin = `${protocol}://${host}`

  return (
    <main className="max-w-2xl mx-auto px-4 py-8">
      <h1 className="text-xl font-bold text-gray-100 mb-1">Delte links</h1>
      <p className="text-sm text-gray-500 mb-6">
        Overblik over dine delte links. Opret et nyt ved at trykke "Del pins" på kortet, hvor du vælger hvilke pins der skal med.
      </p>
      <ShareLinksManager initialShares={shares} origin={origin} pins={pins} categories={categories} />
    </main>
  )
}
