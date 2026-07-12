import { redirect } from 'next/navigation'
import { getSession } from '@/lib/auth'
import { listUsers } from '@/lib/users'
import MaptilerSettingsForm from '@/components/MaptilerSettingsForm'
import UsersManager from '@/components/UsersManager'

export const dynamic = 'force-dynamic'

export default async function IndstillingerPage() {
  const session = await getSession()
  if (!session) redirect('/login')
  if (!session.isAdmin) redirect('/dashboard/kort')

  const users = await listUsers()

  return (
    <main className="max-w-md mx-auto px-4 py-8">
      <h1 className="text-xl font-bold text-gray-100 mb-1">Indstillinger</h1>
      <p className="text-sm text-gray-500 mb-6">Konfigurér kortudbyderen for hele appen</p>

      <div className="card mb-8">
        <MaptilerSettingsForm />
      </div>

      <h2 className="text-lg font-bold text-gray-100 mb-1">Brugere</h2>
      <p className="text-sm text-gray-500 mb-4">Opret konti så andre kan logge ind</p>
      <UsersManager initialUsers={users} currentUserId={session.userId} />
    </main>
  )
}
