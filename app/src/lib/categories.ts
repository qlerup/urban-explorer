import pool from './db'
import { decrypt } from './crypto'
import type { Category } from '@/types/pin'

export async function getCategoriesForUser(userId: string): Promise<Category[]> {
  const result = await pool.query(
    `SELECT c.id, c.name, c.color,
            (SELECT COUNT(*)::int FROM category_shares cs WHERE cs.category_id = c.id) AS share_count
     FROM categories c
     WHERE c.user_id = $1
     ORDER BY c.name`,
    [userId]
  )
  return result.rows.map(row => ({
    id: row.id,
    name: row.name,
    color: row.color,
    shareCount: row.share_count,
  }))
}

/** Kategorier andre brugere har delt med denne bruger. */
export async function getCategoriesSharedWithUser(userId: string): Promise<Category[]> {
  const result = await pool.query(
    `SELECT c.id, c.name, c.color, cs.can_edit, u.first_name AS owner_first_name
     FROM category_shares cs
     JOIN categories c ON c.id = cs.category_id
     JOIN users u ON u.id = c.user_id
     WHERE cs.shared_with_id = $1
     ORDER BY c.name`,
    [userId]
  )
  return result.rows.map(row => ({
    id: row.id,
    name: row.name,
    color: row.color,
    sharedBy: decrypt(row.owner_first_name),
    canEdit: row.can_edit === true,
  }))
}

/** Må brugeren lægge pins i kategorien? Egen kategori eller delt med redigeringsret. */
export async function canUseCategory(userId: string, categoryId: string): Promise<boolean> {
  const result = await pool.query(
    `SELECT 1
     FROM categories c
     LEFT JOIN category_shares cs
       ON cs.category_id = c.id AND cs.shared_with_id = $2 AND cs.can_edit
     WHERE c.id = $1 AND (c.user_id = $2 OR cs.category_id IS NOT NULL)`,
    [categoryId, userId]
  )
  return (result.rowCount ?? 0) > 0
}
