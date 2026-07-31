import pool from './db'

export interface ImportCandidate {
  id: string
  name: string
  description: string
  lat: number
  lng: number
}

export async function getImportCandidatesForUser(userId: string): Promise<ImportCandidate[]> {
  const { rows } = await pool.query(
    `SELECT id, name, description, latitude, longitude
     FROM import_candidates
     WHERE user_id = $1
     ORDER BY created_at`,
    [userId]
  )
  return rows.map(row => ({
    id: row.id,
    name: row.name,
    description: row.description,
    lat: Number(row.latitude),
    lng: Number(row.longitude),
  }))
}

export interface NewImportCandidate {
  name: string
  description: string
  lat: number
  lng: number
}

export async function addImportCandidates(userId: string, items: NewImportCandidate[]): Promise<void> {
  if (items.length === 0) return
  const values: string[] = []
  const params: unknown[] = [userId]
  items.forEach((item, index) => {
    const base = params.length
    params.push(item.name, item.description, item.lat, item.lng)
    values.push(`($1, $${base + 1}, $${base + 2}, $${base + 3}, $${base + 4})`)
    void index
  })
  await pool.query(
    `INSERT INTO import_candidates (user_id, name, description, latitude, longitude) VALUES ${values.join(', ')}`,
    params
  )
}

export async function deleteImportCandidate(userId: string, id: string): Promise<void> {
  await pool.query('DELETE FROM import_candidates WHERE id = $1 AND user_id = $2', [id, userId])
}
