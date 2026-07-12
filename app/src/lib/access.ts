import pool from './db'

export interface PinAccess {
  /** Brugeren ejer selve pinnen */
  isOwner: boolean
  /** Brugeren må redigere pinnen (ejer, kategoriejer eller delt med redigeringsret) */
  canEdit: boolean
  /** Pinnens nuværende kategori */
  categoryId: string | null
}

/**
 * Afgør hvilken adgang brugeren har til en pin. Returnerer null hvis pinnen
 * ikke findes, eller brugeren slet ikke har adgang (heller ikke læseadgang).
 * Adgang opnås som pinnens ejer, som ejer af den kategori pinnen ligger i
 * (samarbejdspins), eller via en kategorideling (vis eller rediger).
 */
export async function getPinAccess(pinId: string, userId: string): Promise<PinAccess | null> {
  const result = await pool.query(
    `SELECT p.user_id = $2 AS is_owner,
            p.category_id,
            c.user_id = $2 AS is_category_owner,
            cs.can_edit AS share_can_edit,
            cs.category_id IS NOT NULL AS is_shared
     FROM pins p
     LEFT JOIN categories c ON c.id = p.category_id
     LEFT JOIN category_shares cs
       ON cs.category_id = p.category_id AND cs.shared_with_id = $2
     WHERE p.id = $1`,
    [pinId, userId]
  )
  if (result.rowCount === 0) return null

  const row = result.rows[0]
  const isOwner = row.is_owner === true
  const isCategoryOwner = row.is_category_owner === true
  const canView = isOwner || isCategoryOwner || row.is_shared === true
  if (!canView) return null

  return {
    isOwner,
    canEdit: isOwner || isCategoryOwner || row.share_can_edit === true,
    categoryId: row.category_id ?? null,
  }
}
