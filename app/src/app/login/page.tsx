import { redirect } from 'next/navigation'
import pool from '@/lib/db'
import { getSession } from '@/lib/auth'
import LoginForm from '@/components/LoginForm'

export const dynamic = 'force-dynamic'

export default async function LoginPage() {
  let userCount = 0
  try {
    const result = await pool.query('SELECT COUNT(*)::int AS count FROM users')
    userCount = result.rows[0].count
  } catch { /* fortsæt til login hvis DB fejler */ }

  if (userCount === 0) redirect('/setup')

  const session = await getSession()
  if (session) redirect('/dashboard/kort')

  return (
    <main className="min-h-screen flex flex-col items-center justify-center bg-void-950 px-4">
      <div className="w-full max-w-md">
        <div className="flex flex-col items-center mb-8">
          <span className="text-4xl mb-2">🔦</span>
          <h1 className="text-2xl font-bold text-gray-100">Urban Explorer</h1>
          <p className="text-gray-500 text-sm mt-1">Log ind for at fortsætte</p>
        </div>

        <div className="card">
          <LoginForm />
        </div>
      </div>
    </main>
  )
}
