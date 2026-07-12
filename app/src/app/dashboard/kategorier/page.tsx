import { redirect } from 'next/navigation'
import { getSession } from '@/lib/auth'
import { getCategoriesForUser, getCategoriesSharedWithUser } from '@/lib/categories'
import CategoriesManager from '@/components/CategoriesManager'

export const dynamic = 'force-dynamic'

export default async function KategorierPage() {
  const session = await getSession()
  if (!session) redirect('/login')

  const [categories, shared] = await Promise.all([
    getCategoriesForUser(session.userId),
    getCategoriesSharedWithUser(session.userId),
  ])

  return (
    <main className="max-w-2xl mx-auto px-4 py-8">
      <h1 className="text-xl font-bold text-gray-100 mb-1">Kategorier</h1>
      <p className="text-sm text-gray-500 mb-6">Opret kategorier til at organisere dine pins med - og del dem med andre brugere</p>
      <CategoriesManager initialCategories={categories} initialShared={shared} />
    </main>
  )
}
