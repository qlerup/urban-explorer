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

export async function getDataforsyningenToken(): Promise<string | null> {
  const result = await pool.query('SELECT dataforsyningen_token FROM app_settings WHERE id = 1')
  const stored = result.rows[0]?.dataforsyningen_token
  if (stored) return decryptIfEncrypted(stored)
  return process.env.DATAFORSYNINGEN_TOKEN || null
}

export async function setDataforsyningenToken(token: string): Promise<void> {
  await pool.query(
    `INSERT INTO app_settings (id, dataforsyningen_token, updated_at) VALUES (1, $1, NOW())
     ON CONFLICT (id) DO UPDATE SET dataforsyningen_token = EXCLUDED.dataforsyningen_token, updated_at = NOW()`,
    [encrypt(token)]
  )
}

export type MapProvider = 'maptiler' | 'esri'

export async function getMapProvider(): Promise<MapProvider> {
  const result = await pool.query('SELECT map_provider FROM app_settings WHERE id = 1')
  return result.rows[0]?.map_provider === 'maptiler' ? 'maptiler' : 'esri'
}

export async function setMapProvider(provider: MapProvider): Promise<void> {
  await pool.query(
    `INSERT INTO app_settings (id, map_provider, updated_at) VALUES (1, $1, NOW())
     ON CONFLICT (id) DO UPDATE SET map_provider = EXCLUDED.map_provider, updated_at = NOW()`,
    [provider]
  )
}
