import { redirect } from 'next/navigation'
import pool from '@/lib/db'
import SetupForm from '@/components/SetupForm'

export const dynamic = 'force-dynamic'

export default async function SetupPage() {
  let userCount = 0
  try {
    const result = await pool.query('SELECT COUNT(*)::int AS count FROM users')
    userCount = result.rows[0].count
  } catch { /* fortsæt til setup hvis DB fejler */ }

  if (userCount > 0) redirect('/login')

  return (
    <main className="min-h-screen flex flex-col items-center justify-center bg-void-950 px-4">
      <div className="w-full max-w-md">
        <div className="flex flex-col items-center mb-8">
          <span className="text-4xl mb-2">🔦</span>
          <h1 className="text-2xl font-bold text-gray-100">Urban Explorer</h1>
          <p className="text-gray-500 text-sm mt-1">Første gang opsætning</p>
        </div>

        <div className="card">
          <div className="mb-6 flex items-center gap-3 p-4 bg-rust-600/10 rounded-xl border border-rust-700/40">
            <div className="w-9 h-9 bg-rust-600 text-white rounded-full flex items-center justify-center shrink-0">
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4M7.835 4.697a3.42 3.42 0 001.946-.806 3.42 3.42 0 014.438 0 3.42 3.42 0 001.946.806 3.42 3.42 0 013.138 3.138 3.42 3.42 0 00.806 1.946 3.42 3.42 0 010 4.438 3.42 3.42 0 00-.806 1.946 3.42 3.42 0 01-3.138 3.138 3.42 3.42 0 00-1.946.806 3.42 3.42 0 01-4.438 0 3.42 3.42 0 00-1.946-.806 3.42 3.42 0 01-3.138-3.138 3.42 3.42 0 00-.806-1.946 3.42 3.42 0 010-4.438 3.42 3.42 0 00.806-1.946 3.42 3.42 0 013.138-3.138z" />
              </svg>
            </div>
            <div>
              <p className="font-semibold text-gray-100 text-sm">Opret admin-konto</p>
              <p className="text-gray-400 text-xs mt-0.5">Dette er den første konto i systemet og oprettes automatisk som admin.</p>
            </div>
          </div>

          <SetupForm />
        </div>
      </div>
    </main>
  )
}
