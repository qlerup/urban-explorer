import pool from './db'
import { encrypt, decryptIfEncrypted } from './crypto'

export async function getMaptilerKey(): Promise<string | null> {
  const result = await pool.query('SELECT maptiler_key FROM app_settings WHERE id = 1')
  const stored = result.rows[0]?.maptiler_key
  if (stored) return decryptIfEncrypted(stored)
  return process.env.MAPTILER_KEY || null
}

export async function setMaptilerKey(key: string): Promise<void> {
  await pool.query(
    `INSERT INTO app_settings (id, maptiler_key, updated_at) VALUES (1, $1, NOW())
     ON CONFLICT (id) DO UPDATE SET maptiler_key = EXCLUDED.maptiler_key, updated_at = NOW()`,
    [encrypt(key)]
  )
}
