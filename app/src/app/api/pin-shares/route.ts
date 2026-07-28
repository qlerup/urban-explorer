import { NextRequest, NextResponse } from 'next/server'
import pool from '@/lib/db'
import { getSession } from '@/lib/auth'
import { listUsers } from '@/lib/users'
import { syncFjordHubUsers } from '@/lib/fjordhub'

interface DirectShareInput {
  userId: string
  canEdit: boolean
}

function normalizeShares(value: unknown, ownUserId: string, validUserIds: Set<string>): DirectShareInput[] {
  if (!Array.isArray(value)) return []
  const shares = new Map<string, DirectShareInput>()
  for (const item of value) {
    if (!item || typeof item !== 'object') continue
    const candidate = item as { userId?: unknown; canEdit?: unknown }
    if (typeof candidate.userId !== 'string' || candidate.userId === ownUserId || !validUserIds.has(candidate.userId)) continue
    shares.set(candidate.userId, { userId: candidate.userId, canEdit: candidate.canEdit === true })
  }
  return Array.from(shares.values())
}

export async function GET(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Ingen adgang' }, { status: 401 })

  await syncFjordHubUsers()
  const pinId = req.nextUrl.searchParams.get('pinId')
  if (pinId) {
    const owned = await pool.query('SELECT 1 FROM pins WHERE id = $1 AND user_id = $2', [pinId, session.userId])
    if ((owned.rowCount ?? 0) === 0) {
      return NextResponse.json({ error: 'Pin ikke fundet' }, { status: 404 })
    }
  }

  const [allUsers, sharesResult] = await Promise.all([
    listUsers(),
    pinId
      ? pool.query(
          'SELECT shared_with_id, can_edit FROM pin_shares WHERE pin_id = $1 ORDER BY created_at',
          [pinId]
        )
      : Promise.resolve({ rows: [] }),
  ])

  return NextResponse.json({
    users: allUsers
      .filter(user => user.id !== session.userId)
      .map(user => ({ id: user.id, firstName: user.firstName })),
    shares: sharesResult.rows.map(row => ({ userId: row.shared_with_id, canEdit: row.can_edit === true })),
  })
}

export async function PUT(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Ingen adgang' }, { status: 401 })

  const body = await req.json()
  const pinId = typeof body.pinId === 'string' ? body.pinId : ''
  const owned = await pool.query('SELECT 1 FROM pins WHERE id = $1 AND user_id = $2', [pinId, session.userId])
  if ((owned.rowCount ?? 0) === 0) {
    return NextResponse.json({ error: 'Pin ikke fundet' }, { status: 404 })
  }

  const usersResult = await pool.query('SELECT id FROM users WHERE id != $1', [session.userId])
  const validUserIds = new Set<string>(usersResult.rows.map(row => row.id))
  const shares = normalizeShares(body.shares, session.userId, validUserIds)

  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query('DELETE FROM pin_shares WHERE pin_id = $1', [pinId])
    for (const share of shares) {
      await client.query(
        'INSERT INTO pin_shares (pin_id, shared_with_id, can_edit) VALUES ($1, $2, $3)',
        [pinId, share.userId, share.canEdit]
      )
    }
    await client.query('COMMIT')
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }

  return NextResponse.json({ success: true, shares })
}
