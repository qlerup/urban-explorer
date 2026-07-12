import { NextRequest, NextResponse } from 'next/server'
import pool from '@/lib/db'
import { getSession } from '@/lib/auth'
import { listUsers } from '@/lib/users'
import { syncFjordHubUsers } from '@/lib/fjordhub'

async function ownsCategory(categoryId: string, userId: string): Promise<boolean> {
  const result = await pool.query('SELECT 1 FROM categories WHERE id = $1 AND user_id = $2', [categoryId, userId])
  return (result.rowCount ?? 0) > 0
}

/** Ejerens overblik: hvem kategorien er delt med + hvilke brugere der kan vælges. */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Ingen adgang' }, { status: 401 })

  const { id } = await params
  if (!(await ownsCategory(id, session.userId))) {
    return NextResponse.json({ error: 'Kategori ikke fundet' }, { status: 404 })
  }

  // Hub-styrede brugere oprettes lokalt, så de kan vælges før første login
  await syncFjordHubUsers()

  const [allUsers, sharesResult] = await Promise.all([
    listUsers(),
    pool.query('SELECT shared_with_id, can_edit FROM category_shares WHERE category_id = $1', [id]),
  ])

  return NextResponse.json({
    users: allUsers
      .filter(u => u.id !== session.userId)
      .map(u => ({ id: u.id, firstName: u.firstName })),
    shares: sharesResult.rows.map(row => ({
      userId: row.shared_with_id,
      canEdit: row.can_edit === true,
    })),
  })
}

/** Erstat kategoriens delinger med den indsendte liste. */
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Ingen adgang' }, { status: 401 })

  const { id } = await params
  if (!(await ownsCategory(id, session.userId))) {
    return NextResponse.json({ error: 'Kategori ikke fundet' }, { status: 404 })
  }

  const body = await req.json()
  const rawShares = Array.isArray(body.shares) ? body.shares : null
  if (!rawShares) return NextResponse.json({ error: 'Ugyldigt format' }, { status: 400 })

  const seen = new Set<string>()
  const shares: { userId: string; canEdit: boolean }[] = []
  for (const entry of rawShares) {
    const userId = typeof entry?.userId === 'string' ? entry.userId : ''
    if (!userId || userId === session.userId || seen.has(userId)) continue
    seen.add(userId)
    shares.push({ userId, canEdit: entry?.canEdit === true })
  }

  if (shares.length > 0) {
    const check = await pool.query('SELECT COUNT(*)::int AS count FROM users WHERE id = ANY($1::uuid[])', [
      shares.map(s => s.userId),
    ])
    if (check.rows[0].count !== shares.length) {
      return NextResponse.json({ error: 'En eller flere brugere findes ikke' }, { status: 400 })
    }
  }

  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query('DELETE FROM category_shares WHERE category_id = $1', [id])
    for (const share of shares) {
      await client.query(
        'INSERT INTO category_shares (category_id, shared_with_id, can_edit) VALUES ($1, $2, $3)',
        [id, share.userId, share.canEdit]
      )
    }
    await client.query('COMMIT')
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }

  return NextResponse.json({ success: true, shareCount: shares.length })
}
