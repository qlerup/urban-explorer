import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getSession } from '@/lib/auth'
import pool from '@/lib/db'
import { decryptIfEncrypted } from '@/lib/crypto'
import { getSavedRoutesForUser } from '@/lib/savedRoutes'
import LogoutButton from '@/components/LogoutButton'

export const dynamic = 'force-dynamic'

function formatDuration(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds)) return 'Ukendt tid'
  const minutes = Math.max(1, Math.round(seconds / 60))
  if (minutes < 60) return `${minutes} min.`
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return rest ? `${hours} t. ${rest} min.` : `${hours} t.`
}

function formatDistance(km: number | null): string {
  if (km === null || !Number.isFinite(km)) return 'Ukendt afstand'
  return `${km.toLocaleString('da-DK', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} km`
}

export default async function ProfilPage() {
  const session = await getSession()
  if (!session) redirect('/login')

  const [result, savedRoutes] = await Promise.all([
    pool.query('SELECT first_name, email, is_admin, created_at FROM users WHERE id = $1', [session.userId]),
    getSavedRoutesForUser(session.userId),
  ])
  const user = result.rows[0]
  const firstName = user ? decryptIfEncrypted(user.first_name) : ''
  const email = user ? decryptIfEncrypted(user.email) : ''

  return (
    <main className="mx-auto max-w-2xl px-4 py-8">
      <h1 className="mb-6 text-xl font-bold text-gray-100">Profil</h1>

      <div className="card space-y-4">
        <div className="flex items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-rust-600/20 text-xl font-semibold text-rust-500">
            {firstName.charAt(0).toUpperCase() || '?'}
          </div>
          <div>
            <p className="font-semibold text-gray-100">{firstName}</p>
            <p className="text-sm text-gray-500">{email}</p>
          </div>
        </div>

        {user?.is_admin && (
          <span className="inline-block rounded-full bg-rust-600/15 px-2.5 py-1 text-xs font-medium text-rust-500">
            Admin
          </span>
        )}

        <div className="border-t border-void-700 pt-4">
          <LogoutButton />
        </div>
      </div>

      <section className="mt-8">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-gray-100">Gemte ruter</h2>
            <p className="text-sm text-gray-500">Ruter du har gemt fra ruteplanlæggeren.</p>
          </div>
          <Link href="/dashboard/ruteplanlaegger" className="btn-secondary whitespace-nowrap text-sm">
            Ny rute
          </Link>
        </div>

        {savedRoutes.length === 0 ? (
          <div className="card text-sm text-gray-500">
            Du har ikke gemt nogen ruter endnu.
          </div>
        ) : (
          <div className="space-y-3">
            {savedRoutes.map(route => (
              <div key={route.id} className="card flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <p className="truncate font-semibold text-gray-100">{route.name}</p>
                  <p className="mt-1 text-sm text-gray-400">
                    {route.routeData.selectedPinIds.length} pins · {formatDistance(route.distanceKm)} · {formatDuration(route.durationSeconds)}
                  </p>
                  <p className="mt-1 text-xs text-gray-600">
                    Gemt {new Date(route.createdAt).toLocaleDateString('da-DK')}
                  </p>
                </div>
                <Link
                  href={`/dashboard/ruteplanlaegger?rute=${encodeURIComponent(route.id)}`}
                  className="btn-primary shrink-0 text-center"
                >
                  Indlæs rute
                </Link>
              </div>
            ))}
          </div>
        )}
      </section>
    </main>
  )
}
