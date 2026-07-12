import pool from './db'
import { decrypt } from './crypto'

export interface UserSummary {
  id: string
  firstName: string
  email: string
  isAdmin: boolean
  lastLoginAt: string | null
  createdAt: string
}

export async function listUsers(): Promise<UserSummary[]> {
  const result = await pool.query(
    'SELECT id, first_name, email, is_admin, last_login_at, created_at FROM users ORDER BY created_at ASC'
  )
  return result.rows.map(row => ({
    id: row.id,
    firstName: decrypt(row.first_name),
    email: decrypt(row.email),
    isAdmin: row.is_admin === true,
    lastLoginAt: row.last_login_at,
    createdAt: row.created_at,
  }))
}

export async function countAdmins(): Promise<number> {
  const result = await pool.query('SELECT COUNT(*)::int AS count FROM users WHERE is_admin = TRUE')
  return result.rows[0].count
}
