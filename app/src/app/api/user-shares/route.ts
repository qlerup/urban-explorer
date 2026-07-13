import { NextRequest, NextResponse } from 'next/server'
import pool from '@/lib/db'
import { getSession } from '@/lib/auth'
import { listUsers } from '@/lib/users'
import { syncFjordHubUsers } from '@/lib/fjordhub'

export interface UserShareState {
  userId: string
  categoryIds: string[]
  uncategorized: boolean
  canEdit: boolean
}

/**
 * Ejerens overblik til "Del med bruger"-modalen: hvilke brugere der kan
 * vælges, ejerens kategorier, og hvad der allerede deles med hvem.
 */
export async function GET() {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Ingen adgang' }, { status: 401 })

  // Hub-styrede brugere oprettes lokalt, så de kan vælges før første login
  await syncFjordHubUsers()

  const [allUsers, categoriesResult, catSharesResult, uncatSharesResult] = await Promise.all([
    listUsers(),
    pool.query('SELECT id, name, color FROM categories WHERE user_id = $1 ORDER BY name', [session.userId]),
    pool.query(
      `SELECT cs.shared_with_id, cs.category_id, cs.can_edit
       FROM category_shares cs
       JOIN categories c ON c.id = cs.category_id
       WHERE c.user_id = $1`,
      [session.userId]
    ),
    pool.query(
      'SELECT shared_with_id, can_edit FROM uncategorized_pin_shares WHERE owner_id = $1',
      [session.userId]
    ),
  ])

  const shareMap = new Map<string, UserShareState>()
  const ensure = (userId: string): UserShareState => {
    let entry = shareMap.get(userId)
    if (!entry) {
      entry = { userId, categoryIds: [], uncategorized: false, canEdit: false }
      shareMap.set(userId, entry)
    }
    return entry
  }
  for (const row of catSharesResult.rows) {
    const entry = ensure(row.shared_with_id)
    entry.categoryIds.push(row.category_id)
    if (row.can_edit === true) entry.canEdit = true
  }
  for (const row of uncatSharesResult.rows) {
    const entry = ensure(row.shared_with_id)
    entry.uncategorized = true
    if (row.can_edit === true) entry.canEdit = true
  }

  return NextResponse.json({
    users: allUsers
      .filter(u => u.id !== session.userId)
      .map(u => ({ id: u.id, firstName: u.firstName })),
    categories: categoriesResult.rows,
    shares: Array.from(shareMap.values()),
  })
}

/** Erstat alt hvad der deles med én bestemt bruger. */
export async function PUT(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Ingen adgang' }, { status: 401 })

  const body = await req.json()
  const targetUserId = typeof body.userId === 'string' ? body.userId : ''
  const rawCategoryIds = Array.isArray(body.categoryIds) ? body.categoryIds : []
  const uncategorized = body.uncategorized === true
  const canEdit = body.canEdit === true

  if (!targetUserId || targetUserId === session.userId) {
    return NextResponse.json({ error: 'Ugyldig bruger' }, { status: 400 })
  }
  const userCheck = await pool.query('SELECT 1 FROM users WHERE id = $1', [targetUserId])
  if ((userCheck.rowCount ?? 0) === 0) {
    return NextResponse.json({ error: 'Brugeren findes ikke' }, { status: 400 })
  }

  // Kun egne kategorier kan deles
  const ownCategories = await pool.query('SELECT id FROM categories WHERE user_id = $1', [session.userId])
  const ownIds = new Set<string>(ownCategories.rows.map(row => row.id))
  const categoryIds = Array.from(new Set(rawCategoryIds.filter((id: unknown): id is string => typeof id === 'string' && ownIds.has(id))))

  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query(
      `DELETE FROM category_shares cs
       USING categories c
       WHERE cs.category_id = c.id AND c.user_id = $1 AND cs.shared_with_id = $2`,
      [session.userId, targetUserId]
    )
    for (const categoryId of categoryIds) {
      await client.query(
        'INSERT INTO category_shares (category_id, shared_with_id, can_edit) VALUES ($1, $2, $3)',
        [categoryId, targetUserId, canEdit]
      )
    }
    await client.query(
      'DELETE FROM uncategorized_pin_shares WHERE owner_id = $1 AND shared_with_id = $2',
      [session.userId, targetUserId]
    )
    if (uncategorized) {
      await client.query(
        'INSERT INTO uncategorized_pin_shares (owner_id, shared_with_id, can_edit) VALUES ($1, $2, $3)',
        [session.userId, targetUserId, canEdit]
      )
    }
    await client.query('COMMIT')
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }

  return NextResponse.json({
    success: true,
    share: { userId: targetUserId, categoryIds, uncategorized, canEdit },
  })
}
