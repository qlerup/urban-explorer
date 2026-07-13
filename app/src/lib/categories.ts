import pool from './db'
import { decrypt } from './crypto'
import type { Category, SharedWorkspace } from '@/types/pin'

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
    `SELECT c.id, c.name, c.color, c.user_id AS owner_id, cs.can_edit, u.first_name AS owner_first_name
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
    ownerId: row.owner_id,
    canEdit: row.can_edit === true,
  }))
}

export async function getSharedWorkspacesForUser(userId: string): Promise<SharedWorkspace[]> {
  const result = await pool.query(
    `SELECT owner_id, owner_first_name,
            BOOL_OR(can_edit) AS can_edit,
            BOOL_OR(is_uncategorized) AS uncategorized,
            BOOL_OR(is_uncategorized AND can_edit) AS can_edit_uncategorized
     FROM (
       SELECT c.user_id AS owner_id, u.first_name AS owner_first_name,
              cs.can_edit, FALSE AS is_uncategorized
       FROM category_shares cs
       JOIN categories c ON c.id = cs.category_id
       JOIN users u ON u.id = c.user_id
       WHERE cs.shared_with_id = $1
       UNION ALL
       SELECT ups.owner_id, u.first_name AS owner_first_name,
              ups.can_edit, TRUE AS is_uncategorized
       FROM uncategorized_pin_shares ups
       JOIN users u ON u.id = ups.owner_id
       WHERE ups.shared_with_id = $1
     ) shared
     GROUP BY owner_id, owner_first_name
     ORDER BY owner_first_name`,
    [userId]
  )
  return result.rows.map(row => ({
    ownerId: row.owner_id,
    ownerName: decrypt(row.owner_first_name),
    canEdit: row.can_edit === true,
    uncategorized: row.uncategorized === true,
    canEditUncategorized: row.can_edit_uncategorized === true,
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
