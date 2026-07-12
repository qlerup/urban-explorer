import { notFound } from 'next/navigation'
import { getShareScopeByToken } from '@/lib/shares'
import ShareTopNav from '@/components/ShareTopNav'
import ShareBottomNav from '@/components/ShareBottomNav'

export const dynamic = 'force-dynamic'

export default async function ShareLayout({
  children,
  params,
}: {
  children: React.ReactNode
  params: Promise<{ token: string }>
}) {
  const { token } = await params
  const scope = await getShareScopeByToken(token)
  if (!scope) notFound()

  return (
    <div className="min-h-screen bg-void-950 flex flex-col">
      <ShareTopNav token={token} />
      <div className="flex-1 pb-24 md:pb-0">{children}</div>
      <ShareBottomNav token={token} />
    </div>
  )
}
