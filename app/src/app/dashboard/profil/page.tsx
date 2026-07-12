import { redirect } from 'next/navigation'
import { getSession } from '@/lib/auth'
import pool from '@/lib/db'
import { decryptIfEncrypted } from '@/lib/crypto'
import LogoutButton from '@/components/LogoutButton'

export const dynamic = 'force-dynamic'

export default async function ProfilPage() {
  const session = await getSession()
  if (!session) redirect('/login')

  const result = await pool.query('SELECT first_name, email, is_admin, created_at FROM users WHERE id = $1', [session.userId])
  const user = result.rows[0]
  const firstName = user ? decryptIfEncrypted(user.first_name) : ''
  const email = user ? decryptIfEncrypted(user.email) : ''

  return (
    <main className="max-w-md mx-auto px-4 py-8">
      <h1 className="text-xl font-bold text-gray-100 mb-6">Profil</h1>

      <div className="card space-y-4">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-full bg-rust-600/20 text-rust-500 flex items-center justify-center text-xl font-semibold">
            {firstName.charAt(0).toUpperCase() || '?'}
          </div>
          <div>
            <p className="font-semibold text-gray-100">{firstName}</p>
            <p className="text-sm text-gray-500">{email}</p>
          </div>
        </div>

        {user?.is_admin && (
          <span className="inline-block text-xs font-medium bg-rust-600/15 text-rust-500 px-2.5 py-1 rounded-full">
            Admin
          </span>
        )}

        <div className="pt-4 border-t border-void-700">
          <LogoutButton />
        </div>
      </div>
    </main>
  )
}
