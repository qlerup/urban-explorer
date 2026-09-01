import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { createSavedRoute, type SavedRouteData } from '@/lib/savedRoutes'

export const dynamic = 'force-dynamic'

function isFiniteNullable(value: unknown): value is number | null {
  return value === null || (typeof value === 'number' && Number.isFinite(value))
}

function isSavedRouteData(value: unknown): value is SavedRouteData {
  if (!value || typeof value !== 'object') return false
  const data = value as Partial<SavedRouteData>

  return typeof data.optimized === 'boolean'
    && Array.isArray(data.orderedStopIds)
    && data.orderedStopIds.every(item => typeof item === 'string')
    && Array.isArray(data.shapes)
    && data.shapes.length > 0
    && data.shapes.length <= 60
    && data.shapes.every(shape => typeof shape === 'string' && shape.length > 0 && shape.length <= 1_000_000)
    && Array.isArray(data.legs)
    && data.legs.length <= 60
    && isFiniteNullable(data.distanceKm)
    && isFiniteNullable(data.durationSeconds)
    && Array.isArray(data.selectedPinIds)
    && data.selectedPinIds.every(id => typeof id === 'string')
    && !!data.stopLabels
    && typeof data.stopLabels === 'object'
    && !!data.stopCoordinates
    && typeof data.stopCoordinates === 'object'
}

export async function POST(request: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Ikke logget ind' }, { status: 401 })

  let body: { name?: unknown; routeData?: unknown }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Ugyldig forespørgsel' }, { status: 400 })
  }

  const name = typeof body.name === 'string' ? body.name.trim() : ''
  if (!name) return NextResponse.json({ error: 'Giv ruten et navn' }, { status: 400 })
  if (name.length > 100) return NextResponse.json({ error: 'Rutenavnet må højst være 100 tegn' }, { status: 400 })
  if (!isSavedRouteData(body.routeData)) {
    return NextResponse.json({ error: 'Rutedata er ugyldige' }, { status: 400 })
  }

  try {
    const saved = await createSavedRoute(session.userId, name, body.routeData)
    return NextResponse.json({ id: saved.id, name: saved.name }, { status: 201 })
  } catch (error) {
    console.error('[saved-routes] Kunne ikke gemme rute:', error)
    return NextResponse.json({ error: 'Ruten kunne ikke gemmes' }, { status: 500 })
  }
}
