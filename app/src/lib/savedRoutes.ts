import pool from './db'

export interface SavedRouteLeg {
  fromId: string | null
  toId: string | null
  distanceKm: number | null
  durationSeconds: number | null
}

export interface SavedRouteData {
  optimized: boolean
  orderedStopIds: string[]
  shapes: string[]
  legs: SavedRouteLeg[]
  distanceKm: number | null
  durationSeconds: number | null
  selectedPinIds: string[]
  stopLabels: Record<string, string>
  stopCoordinates: Record<string, { lat: number; lng: number }>
}

export interface SavedRouteRecord {
  id: string
  name: string
  routeData: SavedRouteData
  distanceKm: number | null
  durationSeconds: number | null
  createdAt: string
  updatedAt: string
}

const SAVED_ROUTES_SQL = `
CREATE TABLE IF NOT EXISTS saved_routes (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name             TEXT NOT NULL,
  route_data       JSONB NOT NULL,
  distance_km      DOUBLE PRECISION,
  duration_seconds INTEGER,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_saved_routes_user_created
  ON saved_routes(user_id, created_at DESC);
`

export async function ensureSavedRoutesSchema(): Promise<void> {
  await pool.query(SAVED_ROUTES_SQL)
}

function rowToSavedRoute(row: Record<string, unknown>): SavedRouteRecord {
  return {
    id: String(row.id),
    name: String(row.name),
    routeData: row.route_data as SavedRouteData,
    distanceKm: typeof row.distance_km === 'number' ? row.distance_km : row.distance_km == null ? null : Number(row.distance_km),
    durationSeconds: typeof row.duration_seconds === 'number' ? row.duration_seconds : row.duration_seconds == null ? null : Number(row.duration_seconds),
    createdAt: new Date(String(row.created_at)).toISOString(),
    updatedAt: new Date(String(row.updated_at)).toISOString(),
  }
}

export async function createSavedRoute(
  userId: string,
  name: string,
  routeData: SavedRouteData
): Promise<SavedRouteRecord> {
  const result = await pool.query(
    `INSERT INTO saved_routes (user_id, name, route_data, distance_km, duration_seconds)
     VALUES ($1, $2, $3::jsonb, $4, $5)
     RETURNING id, name, route_data, distance_km, duration_seconds, created_at, updated_at`,
    [userId, name, JSON.stringify(routeData), routeData.distanceKm, routeData.durationSeconds]
  )
  return rowToSavedRoute(result.rows[0])
}

export async function getSavedRoutesForUser(userId: string): Promise<SavedRouteRecord[]> {
  const result = await pool.query(
    `SELECT id, name, route_data, distance_km, duration_seconds, created_at, updated_at
     FROM saved_routes
     WHERE user_id = $1
     ORDER BY created_at DESC`,
    [userId]
  )
  return result.rows.map(rowToSavedRoute)
}

export async function getSavedRouteForUser(userId: string, routeId: string): Promise<SavedRouteRecord | null> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(routeId)) {
    return null
  }

  const result = await pool.query(
    `SELECT id, name, route_data, distance_km, duration_seconds, created_at, updated_at
     FROM saved_routes
     WHERE id = $1 AND user_id = $2
     LIMIT 1`,
    [routeId, userId]
  )
  return result.rows[0] ? rowToSavedRoute(result.rows[0]) : null
}
