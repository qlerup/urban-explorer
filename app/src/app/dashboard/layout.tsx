import { redirect } from 'next/navigation'
import { getSession } from '@/lib/auth'
import TopNav from '@/components/TopNav'
import BottomNav from '@/components/BottomNav'

export const dynamic = 'force-dynamic'

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession()
  if (!session) redirect('/login')

  return (
    <div className="min-h-screen bg-void-950 flex flex-col">
      <TopNav isAdmin={session.isAdmin} />
      <div className="flex-1 pb-24 md:pb-0">{children}</div>
      <BottomNav isAdmin={session.isAdmin} />
    </div>
  )
}
