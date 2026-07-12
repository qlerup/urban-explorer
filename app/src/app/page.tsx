import { redirect } from 'next/navigation'
import pool from '@/lib/db'
import { getSession } from '@/lib/auth'
import { isFjordHubManaged } from '@/lib/fjordhub'

export const dynamic = 'force-dynamic'

export default async function RootPage() {
  let userCount = 0
  try {
    const result = await pool.query('SELECT COUNT(*)::int AS count FROM users')
    userCount = result.rows[0].count
  } catch { /* fald igennem til login hvis DB ikke er klar */ }

  // Når FjordHub styrer brugerne, oprettes de via SSO - spring setup over
  if (userCount === 0 && !isFjordHubManaged()) redirect('/setup')

  const session = await getSession()
  redirect(session ? '/dashboard/kort' : '/login')
}
