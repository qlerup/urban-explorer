import pool from './db'

export interface GridCell {
  row: number
  col: number
}

export interface GridWorkspaceAccess {
  canView: boolean
  canEdit: boolean
}

export async function getGridWorkspaceAccess(viewerId: string, ownerId: string): Promise<GridWorkspaceAccess> {
  if (viewerId === ownerId) return { canView: true, canEdit: true }
  const result = await pool.query(
    `SELECT
       EXISTS (
         SELECT 1 FROM category_shares cs
         JOIN categories c ON c.id = cs.category_id
         WHERE cs.shared_with_id = $1 AND c.user_id = $2
       ) OR EXISTS (
         SELECT 1 FROM uncategorized_pin_shares ups
         WHERE ups.shared_with_id = $1 AND ups.owner_id = $2
       ) AS can_view,
       EXISTS (
         SELECT 1 FROM category_shares cs
         JOIN categories c ON c.id = cs.category_id
         WHERE cs.shared_with_id = $1 AND c.user_id = $2 AND cs.can_edit
       ) OR EXISTS (
         SELECT 1 FROM uncategorized_pin_shares ups
         WHERE ups.shared_with_id = $1 AND ups.owner_id = $2 AND ups.can_edit
       ) AS can_edit`,
    [viewerId, ownerId]
  )
  return {
    canView: result.rows[0]?.can_view === true,
    canEdit: result.rows[0]?.can_edit === true,
  }
}

export async function getGridCellsForUser(userId: string): Promise<GridCell[]> {
  const result = await pool.query('SELECT row, col FROM grid_cells WHERE user_id = $1', [userId])
  return result.rows
}

export async function setGridCellSearched(userId: string, row: number, col: number, searched: boolean): Promise<void> {
  if (searched) {
    await pool.query(
      'INSERT INTO grid_cells (user_id, row, col) VALUES ($1, $2, $3) ON CONFLICT (user_id, row, col) DO NOTHING',
      [userId, row, col]
    )
  } else {
    await pool.query('DELETE FROM grid_cells WHERE user_id = $1 AND row = $2 AND col = $3', [userId, row, col])
  }
}
