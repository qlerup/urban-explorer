import { redirect } from 'next/navigation'
import { getSession } from '@/lib/auth'
import ChangePasswordForm from '@/components/ChangePasswordForm'

export const dynamic = 'force-dynamic'

export default async function SkiftAdgangskodePage() {
  const session = await getSession()
  if (!session) redirect('/login')

  return (
    <main className="min-h-screen flex flex-col items-center justify-center bg-void-950 px-4">
      <div className="w-full max-w-md">
        <div className="flex flex-col items-center mb-8">
          <span className="text-4xl mb-2">🔑</span>
          <h1 className="text-2xl font-bold text-gray-100">Vælg din egen adgangskode</h1>
          <p className="text-gray-500 text-sm mt-1 text-center">
            Din konto er oprettet med en midlertidig adgangskode. Vælg en ny, som kun du kender.
          </p>
        </div>

        <div className="card">
          <ChangePasswordForm />
        </div>
      </div>
    </main>
  )
}
