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

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Ingen adgang' }, { status: 401 })

  const { id } = await params

  const access = await getPinAccess(id, session.userId)
  if (!access) return NextResponse.json({ error: 'Pin ikke fundet' }, { status: 404 })
  if (!access.canEdit) return NextResponse.json({ error: 'Du har kun læseadgang til denne pin' }, { status: 403 })

  const body = await req.json()
  const name = typeof body.name === 'string' ? body.name.trim().slice(0, 100) : ''
  if (!name) return NextResponse.json({ error: 'Ruten skal have et navn' }, { status: 400 })

  const points = parsePoints(body.points)
  if ('error' in points) return NextResponse.json({ error: points.error }, { status: 400 })

  const distanceMeters = routeDistanceMeters(points)

  const result = await pool.query(
    `INSERT INTO pin_routes (pin_id, name, points, distance_meters)
     VALUES ($1, $2, $3::jsonb, $4)
     RETURNING id`,
    [id, name, JSON.stringify(points), distanceMeters]
  )

  return NextResponse.json({
    success: true,
    route: { id: result.rows[0].id, name, points, distanceMeters },
  })
}
