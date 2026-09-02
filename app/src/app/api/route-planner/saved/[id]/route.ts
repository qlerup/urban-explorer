import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { getSavedRouteForUser } from '@/lib/savedRoutes'

export const dynamic = 'force-dynamic'

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Ikke logget ind' }, { status: 401 })

  const { id } = await params

  try {
    const route = await getSavedRouteForUser(session.userId, id)
    if (!route) return NextResponse.json({ error: 'Ruten blev ikke fundet' }, { status: 404 })

    return NextResponse.json({
      id: route.id,
      name: route.name,
      routeData: route.routeData,
    })
  } catch (error) {
    console.error('[saved-routes] Kunne ikke hente rute:', error)
    return NextResponse.json({ error: 'Ruten kunne ikke hentes' }, { status: 500 })
  }
}
