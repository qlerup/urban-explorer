import { NextRequest, NextResponse } from 'next/server'
import pool from '@/lib/db'
import { getSession } from '@/lib/auth'
import { getPinAccess } from '@/lib/access'
import { routeDistanceMeters } from '@/lib/geo'
import type { RoutePoint } from '@/types/pin'

const MAX_POINTS = 500

function parsePoints(rawPoints: unknown): RoutePoint[] | { error: string } {
  if (!Array.isArray(rawPoints) || rawPoints.length < 2) {
    return { error: 'Ruten skal have mindst 2 punkter' }
  }
  if (rawPoints.length > MAX_POINTS) {
    return { error: 'Ruten har for mange punkter' }
  }
  const points: RoutePoint[] = []
  for (const p of rawPoints) {
    const lat = Number((p as { lat?: unknown })?.lat)
    const lng = Number((p as { lng?: unknown })?.lng)
    if (!Number.isFinite(lat) || lat < -90 || lat > 90 || !Number.isFinite(lng) || lng < -180 || lng > 180) {
      return { error: 'Ugyldige koordinater i ruten' }
    }
    points.push({ lat, lng })
  }
  return points
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string; routeId: string }> }) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Ingen adgang' }, { status: 401 })

  const { id, routeId } = await params

  const access = await getPinAccess(id, session.userId)
  if (!access) return NextResponse.json({ error: 'Rute ikke fundet' }, { status: 404 })
  if (!access.canEdit) return NextResponse.json({ error: 'Du har kun læseadgang til denne pin' }, { status: 403 })

  const routeCheck = await pool.query(
    'SELECT pr.id FROM pin_routes pr WHERE pr.id = $1 AND pr.pin_id = $2',
    [routeId, id]
  )
  if (routeCheck.rowCount === 0) return NextResponse.json({ error: 'Rute ikke fundet' }, { status: 404 })

  const body = await req.json()
  const points = parsePoints(body.points)
  if ('error' in points) return NextResponse.json({ error: points.error }, { status: 400 })

  const distanceMeters = routeDistanceMeters(points)

  await pool.query(
    `UPDATE pin_routes SET points = $1::jsonb, distance_meters = $2, updated_at = NOW() WHERE id = $3`,
    [JSON.stringify(points), distanceMeters, routeId]
  )

  return NextResponse.json({ success: true, route: { id: routeId, points, distanceMeters } })
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string; routeId: string }> }) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Ingen adgang' }, { status: 401 })

  const { id, routeId } = await params

  const access = await getPinAccess(id, session.userId)
  if (!access) return NextResponse.json({ error: 'Rute ikke fundet' }, { status: 404 })
  if (!access.canEdit) return NextResponse.json({ error: 'Du har kun læseadgang til denne pin' }, { status: 403 })

  await pool.query(
    'DELETE FROM pin_routes pr WHERE pr.id = $1 AND pr.pin_id = $2',
    [routeId, id]
  )
  return NextResponse.json({ success: true })
}
