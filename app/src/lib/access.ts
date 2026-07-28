import pool from './db'

export interface PinAccess {
  /** Brugeren ejer selve pinnen */
  isOwner: boolean
  /** Brugeren må redigere pinnen (ejer, kategoriejer eller delt med redigeringsret) */
  canEdit: boolean
  /** Pinnens nuværende kategori */
  categoryIds: string[]
}

/**
 * Afgør hvilken adgang brugeren har til en pin. Returnerer null hvis pinnen
 * ikke findes, eller brugeren slet ikke har adgang (heller ikke læseadgang).
 * Adgang opnås som pinnens ejer, som ejer af den kategori pinnen ligger i
 * (samarbejdspins), via en kategorideling (vis eller rediger), eller via
 * deling af ejerens ukategoriserede pins.
 */
export async function getPinAccess(pinId: string, userId: string): Promise<PinAccess | null> {
  const result = await pool.query(
    `SELECT p.user_id = $2 AS is_owner,
            COALESCE((
              SELECT array_agg(pc.category_id ORDER BY pc.position)
              FROM pin_categories pc
              WHERE pc.pin_id = p.id
            ), ARRAY[]::uuid[]) AS category_ids,
            EXISTS (
              SELECT 1 FROM pin_categories pc
              JOIN categories c ON c.id = pc.category_id
              WHERE pc.pin_id = p.id AND c.user_id = $2
            ) AS is_category_owner,
            EXISTS (
              SELECT 1 FROM pin_categories pc
              JOIN category_shares cs ON cs.category_id = pc.category_id
              WHERE pc.pin_id = p.id AND cs.shared_with_id = $2 AND cs.can_edit
            ) AS share_can_edit,
            EXISTS (
              SELECT 1 FROM pin_categories pc
              JOIN category_shares cs ON cs.category_id = pc.category_id
              WHERE pc.pin_id = p.id AND cs.shared_with_id = $2
            ) AS is_shared,
            ups.can_edit AS uncat_share_can_edit,
            ups.id IS NOT NULL AS is_uncat_shared
     FROM pins p
     LEFT JOIN uncategorized_pin_shares ups
       ON ups.owner_id = p.user_id AND ups.shared_with_id = $2
       AND NOT EXISTS (SELECT 1 FROM pin_categories pc WHERE pc.pin_id = p.id)
     WHERE p.id = $1`,
    [pinId, userId]
  )
  if (result.rowCount === 0) return null

  const row = result.rows[0]
  const isOwner = row.is_owner === true
  const isCategoryOwner = row.is_category_owner === true
  const canView = isOwner || isCategoryOwner || row.is_shared === true || row.is_uncat_shared === true
  if (!canView) return null

  return {
    isOwner,
    canEdit: isOwner || isCategoryOwner || row.share_can_edit === true || row.uncat_share_can_edit === true,
    categoryIds: row.category_ids ?? [],
  }
}
