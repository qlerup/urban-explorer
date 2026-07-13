import pool from './db'
import { decrypt } from './crypto'
import type { Pin, PinStatus, PinRoute } from '@/types/pin'

const ROUTES_SUBQUERY = `(
  SELECT COALESCE(
    json_agg(
      json_build_object('id', pr.id, 'name', pr.name, 'points', pr.points, 'distanceMeters', pr.distance_meters)
      ORDER BY pr.created_at
    ),
    '[]'
  )
  FROM pin_routes pr WHERE pr.pin_id = p.id
) AS routes`

interface PinRow {
  id: string
  name: string
  description: string
  latitude: string
  longitude: string
  rating: number
  status: PinStatus
  icon: string
  created_at: string
  category_id: string | null
  category_name: string | null
  category_color: string | null
  images: { id: string; originalName: string }[]
  routes?: PinRoute[]
  can_edit?: boolean
  owner_id?: string
  owner_first_name?: string | null
}

function mapRow(row: PinRow): Pin {
  const pin: Pin = {
    id: row.id,
    name: row.name,
    description: row.description ?? '',
    latitude: Number(row.latitude),
    longitude: Number(row.longitude),
    rating: row.rating,
    status: row.status,
    icon: row.icon || '📍',
    category: row.category_id
      ? {
          id: row.category_id,
          name: row.category_name ?? '',
          color: row.category_color ?? '#e08a3c',
        }
      : null,
    createdAt: row.created_at,
    images: row.images.map(img => ({
      id: img.id,
      originalName: img.originalName,
      url: `/api/pins/${row.id}/images/${img.id}`,
    })),
    routes: row.routes ?? [],
  }
  if (row.can_edit === false) pin.canEdit = false
  if (row.owner_first_name) {
    pin.ownerName = decrypt(row.owner_first_name)
    pin.ownerId = row.owner_id
  }
  return pin
}

export async function getPinsForUser(userId: string): Promise<Pin[]> {
  // Synlige pins: egne, pins i kategorier delt med brugeren, andres pins
  // lagt i brugerens egne kategorier (samarbejde i delte "mapper"), og
  // ukategoriserede pins fra ejere der har delt dem med brugeren.
  const result = await pool.query<PinRow>(
    `SELECT p.id, p.name, p.description, p.latitude, p.longitude, p.rating, p.status, p.icon, p.created_at,
            c.id AS category_id, c.name AS category_name, c.color AS category_color,
            (p.user_id = $1 OR COALESCE(c.user_id = $1, FALSE) OR COALESCE(cs.can_edit, FALSE) OR COALESCE(ups.can_edit, FALSE)) AS can_edit,
            p.user_id AS owner_id,
            CASE WHEN p.user_id = $1 THEN NULL ELSE u.first_name END AS owner_first_name,
            COALESCE(
              json_agg(json_build_object('id', i.id, 'originalName', i.original_name) ORDER BY i.created_at)
              FILTER (WHERE i.id IS NOT NULL),
              '[]'
            ) AS images,
            ${ROUTES_SUBQUERY}
     FROM pins p
     JOIN users u ON u.id = p.user_id
     LEFT JOIN pin_images i ON i.pin_id = p.id
     LEFT JOIN categories c ON c.id = p.category_id
     LEFT JOIN category_shares cs ON cs.category_id = p.category_id AND cs.shared_with_id = $1
     LEFT JOIN uncategorized_pin_shares ups
       ON ups.owner_id = p.user_id AND ups.shared_with_id = $1 AND p.category_id IS NULL
     WHERE p.user_id = $1 OR c.user_id = $1 OR cs.category_id IS NOT NULL OR ups.id IS NOT NULL
     GROUP BY p.id, c.id, c.name, c.color, cs.can_edit, ups.can_edit, u.first_name
     ORDER BY p.created_at DESC`,
    [userId]
  )
  return result.rows.map(mapRow)
}

export async function getPinsByIds(userId: string, pinIds: string[]): Promise<Pin[]> {
  if (pinIds.length === 0) return []
  const result = await pool.query<PinRow>(
    `SELECT p.id, p.name, p.description, p.latitude, p.longitude, p.rating, p.status, p.icon, p.created_at,
            c.id AS category_id, c.name AS category_name, c.color AS category_color,
            COALESCE(
              json_agg(json_build_object('id', i.id, 'originalName', i.original_name) ORDER BY i.created_at)
              FILTER (WHERE i.id IS NOT NULL),
              '[]'
            ) AS images,
            ${ROUTES_SUBQUERY}
     FROM pins p
     LEFT JOIN pin_images i ON i.pin_id = p.id
     LEFT JOIN categories c ON c.id = p.category_id
     WHERE p.user_id = $1 AND p.id = ANY($2::uuid[])
     GROUP BY p.id, c.id, c.name, c.color
     ORDER BY p.created_at DESC`,
    [userId, pinIds]
  )
  return result.rows.map(mapRow)
}

export function mapPinRow(row: PinRow): Pin {
  return mapRow(row)
}

export interface PinExportImage {
  filename: string
  mimeType: string
}

export interface PinExportRow {
  id: string
  name: string
  description: string
  latitude: number
  longitude: number
  rating: number
  status: PinStatus
  icon: string
  categoryName: string | null
  categoryColor: string | null
  createdAt: string
  images: PinExportImage[]
  routes: PinRoute[]
}

export async function getPinsForExport(userId: string): Promise<PinExportRow[]> {
  const result = await pool.query(
    `SELECT p.id, p.name, p.description, p.latitude, p.longitude, p.rating, p.status, p.icon, p.created_at,
            c.name AS category_name, c.color AS category_color,
            COALESCE(
              json_agg(json_build_object('filename', i.filename, 'mimeType', i.mime_type) ORDER BY i.created_at)
              FILTER (WHERE i.id IS NOT NULL),
              '[]'
            ) AS images,
            ${ROUTES_SUBQUERY}
     FROM pins p
     LEFT JOIN pin_images i ON i.pin_id = p.id
     LEFT JOIN categories c ON c.id = p.category_id
     WHERE p.user_id = $1
     GROUP BY p.id, c.name, c.color
     ORDER BY p.created_at DESC`,
    [userId]
  )
  return result.rows.map(row => ({
    id: row.id,
    name: row.name,
    description: row.description ?? '',
    latitude: Number(row.latitude),
    longitude: Number(row.longitude),
    rating: row.rating,
    status: row.status,
    icon: row.icon || '📍',
    categoryName: row.category_name,
    categoryColor: row.category_color,
    routes: row.routes ?? [],
    createdAt: row.created_at,
    images: row.images,
  }))
}
