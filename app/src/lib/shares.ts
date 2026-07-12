import { randomBytes } from 'crypto'
import pool from './db'

export interface ShareLink {
  id: string
  token: string
  label: string
  pinCount: number
  pinIds: string[]
  createdAt: string
}

export interface ShareScope {
  userId: string
  pinIds: string[]
}

type ShareLinkRow = {
  id: string
  token: string
  label: string
  pin_count: string
  pin_ids: string[] | null
  created_at: string
}

export type UpdateShareLinkResult =
  | { status: 'ok'; share: ShareLink }
  | { status: 'not_found' }
  | { status: 'no_pins' }

function mapRow(row: ShareLinkRow): ShareLink {
  return {
    id: row.id,
    token: row.token,
    label: row.label,
    pinCount: Number(row.pin_count),
    pinIds: row.pin_ids ?? [],
    createdAt: row.created_at,
  }
}

export async function getShareLinksForUser(userId: string): Promise<ShareLink[]> {
  const result = await pool.query(
    `SELECT s.id, s.token, s.label, s.created_at, COUNT(slp.pin_id) AS pin_count,
            COALESCE(
              array_agg(slp.pin_id::text ORDER BY slp.pin_id) FILTER (WHERE slp.pin_id IS NOT NULL),
              ARRAY[]::text[]
            ) AS pin_ids
     FROM share_links s
     LEFT JOIN share_link_pins slp ON slp.share_link_id = s.id
     WHERE s.user_id = $1
     GROUP BY s.id
     ORDER BY s.created_at DESC`,
    [userId]
  )
  return result.rows.map(mapRow)
}

export async function createShareLink(userId: string, label: string, pinIds: string[]): Promise<ShareLink | null> {
  const ownedPins = await pool.query('SELECT id FROM pins WHERE user_id = $1 AND id = ANY($2::uuid[])', [userId, pinIds])
  const confirmedIds = ownedPins.rows.map(r => r.id as string)
  if (confirmedIds.length === 0) return null

  const token = randomBytes(18).toString('base64url')
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const inserted = await client.query(
      'INSERT INTO share_links (user_id, token, label) VALUES ($1, $2, $3) RETURNING id, token, label, created_at',
      [userId, token, label]
    )
    const share = inserted.rows[0]
    await client.query(
      `INSERT INTO share_link_pins (share_link_id, pin_id) SELECT $1, unnest($2::uuid[])`,
      [share.id, confirmedIds]
    )
    await client.query('COMMIT')
    return {
      id: share.id,
      token: share.token,
      label: share.label,
      pinCount: confirmedIds.length,
      pinIds: confirmedIds,
      createdAt: share.created_at,
    }
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}

export async function updateShareLink(userId: string, id: string, label: string, pinIds: string[]): Promise<UpdateShareLinkResult> {
  const uniquePinIds = Array.from(new Set(pinIds))
  const ownedPins = await pool.query('SELECT id FROM pins WHERE user_id = $1 AND id = ANY($2::uuid[])', [userId, uniquePinIds])
  const confirmedIds = ownedPins.rows.map(r => r.id as string)
  if (confirmedIds.length === 0) return { status: 'no_pins' }

  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const updated = await client.query(
      'UPDATE share_links SET label = $3 WHERE id = $1 AND user_id = $2 RETURNING id, token, label, created_at',
      [id, userId, label]
    )
    const share = updated.rows[0]
    if (!share) {
      await client.query('ROLLBACK')
      return { status: 'not_found' }
    }

    await client.query('DELETE FROM share_link_pins WHERE share_link_id = $1', [id])
    await client.query(
      `INSERT INTO share_link_pins (share_link_id, pin_id) SELECT $1, unnest($2::uuid[])`,
      [id, confirmedIds]
    )
    await client.query('COMMIT')

    return {
      status: 'ok',
      share: {
        id: share.id,
        token: share.token,
        label: share.label,
        pinCount: confirmedIds.length,
        pinIds: confirmedIds,
        createdAt: share.created_at,
      },
    }
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}

export async function deleteShareLink(id: string, userId: string): Promise<boolean> {
  const result = await pool.query('DELETE FROM share_links WHERE id = $1 AND user_id = $2', [id, userId])
  return (result.rowCount ?? 0) > 0
}

export async function getShareScopeByToken(token: string): Promise<ShareScope | null> {
  const shareResult = await pool.query('SELECT id, user_id FROM share_links WHERE token = $1', [token])
  const share = shareResult.rows[0]
  if (!share) return null

  const pinsResult = await pool.query('SELECT pin_id FROM share_link_pins WHERE share_link_id = $1', [share.id])
  return { userId: share.user_id, pinIds: pinsResult.rows.map(r => r.pin_id as string) }
}
