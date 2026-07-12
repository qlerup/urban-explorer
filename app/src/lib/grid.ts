import pool from './db'

export interface GridCell {
  row: number
  col: number
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
