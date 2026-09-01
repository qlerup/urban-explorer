import pool from './db'
import { decryptIfEncrypted, encrypt, hashEmail } from './crypto'

export interface FjordHubUser {
  id: number
  username: string
  email?: string
  role?: 'admin' | 'user'
  hub_role?: 'admin' | 'user'
  first_name?: string
  last_name?: string
  language?: string
  must_change_password?: boolean
}

interface LegacyUrbanExplorerUser {
  id: string
  first_name: string
  email: string
  password_hash: string
  is_admin: boolean
}

// Sentinel i password_hash for hub-styrede brugere: kan aldrig verificeres
// som Argon2, så lokalt password-login er automatisk blokeret for dem.
const MANAGED_PASSWORD_HASH = 'fjordhub-managed'
let legacyUserMigration: Promise<void> | null = null

export function isFjordHubManaged(): boolean {
  return Boolean(
    process.env.FJORDHUB_APP_ID === 'urban-explorer' &&
    process.env.FJORDHUB_URL &&
    process.env.FJORDHUB_API_KEY
  )
}

/** Deterministisk pseudo-email for en hub-bruger, så email_hash kan slås op. */
function managedEmail(username: string, email?: string): string {
  return String(email || '').trim().toLowerCase() || `${username.trim().toLowerCase()}@fjordhub.local`
}

async function hubRequest(
  path: string,
  payload: Record<string, unknown>,
  method: 'GET' | 'POST' = 'POST'
): Promise<Record<string, unknown>> {
  if (!isFjordHubManaged()) return { ok: false, error: 'FjordHub integration is not active' }

  const appId = process.env.FJORDHUB_APP_ID as string
  const baseUrl = (process.env.FJORDHUB_URL as string).replace(/\/$/, '')
  const data = { ...payload, app_id: appId }
  let url = `${baseUrl}${path}`
  const init: RequestInit = {
    method,
    cache: 'no-store',
    headers: { 'X-Hub-Key': process.env.FJORDHUB_API_KEY as string },
    signal: AbortSignal.timeout(6000),
  }

  if (method === 'GET') {
    const params = new URLSearchParams()
    for (const [key, value] of Object.entries(data)) params.set(key, String(value))
    url += `?${params.toString()}`
  } else {
    init.headers = { ...init.headers, 'Content-Type': 'application/json' }
    init.body = JSON.stringify(data)
  }

  try {
    const response = await fetch(url, init)
    const result = await response.json().catch(() => ({}))
    return typeof result === 'object' && result ? result : { ok: false }
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'Could not contact FjordHub',
    }
  }
}

async function migrateLegacyUsers(): Promise<void> {
  try {
    const localUsers = await pool.query<LegacyUrbanExplorerUser>(
      `SELECT id, first_name, email, password_hash, is_admin
       FROM users
       WHERE fjordhub_migrated_at IS NULL
         AND password_hash LIKE '$argon2%'`
    )
    let migratedCount = 0

    for (const localUser of localUsers.rows) {
      const email = decryptIfEncrypted(localUser.email).trim().toLowerCase()
      if (!email) {
        console.error('[fjordhub] Kan ikke migrere bruger uden email:', localUser.id)
        continue
      }

      const result = await hubRequest('/api/hub/apps/users', {
        first_name: decryptIfEncrypted(localUser.first_name).trim(),
        email,
        password_hash: localUser.password_hash,
        role: localUser.is_admin ? 'admin' : 'user',
      })
      if (result.ok !== true) {
        console.error('[fjordhub] Kunne ikke migrere bruger:', localUser.id, result.error || 'ukendt fejl')
        continue
      }

      await pool.query(
        'UPDATE users SET fjordhub_migrated_at = NOW(), updated_at = NOW() WHERE id = $1 AND fjordhub_migrated_at IS NULL',
        [localUser.id]
      )
      migratedCount += 1
    }

    if (migratedCount > 0) {
      console.log(`[fjordhub] Migrerede ${migratedCount} eksisterende brugere til FjordHub`)
    }
  } catch (error) {
    console.error('[fjordhub] Kunne ikke migrere eksisterende brugere:', error)
  }
}

/** Overfor kun lokale Argon2-brugere, når Urban Explorer styres af FjordHub. */
export async function migrateLegacyUsersToFjordHub(): Promise<void> {
  if (!isFjordHubManaged()) return
  if (!legacyUserMigration) {
    legacyUserMigration = migrateLegacyUsers().finally(() => {
      legacyUserMigration = null
    })
  }
  await legacyUserMigration
}

export async function authenticateWithFjordHub(
  username: string,
  password: string
): Promise<FjordHubUser | null> {
  const result = await hubRequest('/api/hub/apps/authenticate', { username, password })
  const user = result.user
  return result.ok === true && user && typeof user === 'object' ? user as FjordHubUser : null
}

export async function changeFjordHubPassword(
  username: string,
  currentPassword: string,
  newPassword: string
): Promise<{ user: FjordHubUser | null; error?: string }> {
  const result = await hubRequest('/api/hub/apps/change-password', {
    username,
    current_password: currentPassword,
    new_password: newPassword,
  })
  const user = result.user
  if (result.ok === true && user && typeof user === 'object') {
    return { user: user as FjordHubUser }
  }
  return { user: null, error: typeof result.error === 'string' ? result.error : undefined }
}

export async function requestFjordHubPasswordReset(email: string): Promise<{ challengeId: string }> {
  const result = await hubRequest('/api/hub/apps/password-reset/request', { email })
  return { challengeId: typeof result.challenge_id === 'string' ? result.challenge_id : '' }
}

export async function verifyFjordHubPasswordReset(
  challengeId: string,
  code: string
): Promise<{ resetToken?: string; error?: string }> {
  const result = await hubRequest('/api/hub/apps/password-reset/verify', {
    challenge_id: challengeId,
    code,
  })
  if (result.ok === true && typeof result.reset_token === 'string') {
    return { resetToken: result.reset_token }
  }
  return { error: typeof result.error === 'string' ? result.error : 'Koden er ugyldig eller udløbet' }
}

export async function completeFjordHubPasswordReset(
  challengeId: string,
  resetToken: string,
  password: string
): Promise<{ ok: boolean; error?: string }> {
  const result = await hubRequest('/api/hub/apps/password-reset/complete', {
    challenge_id: challengeId,
    reset_token: resetToken,
    password,
  })
  return {
    ok: result.ok === true,
    error: typeof result.error === 'string' ? result.error : undefined,
  }
}

export async function verifyFjordHubSsoToken(token: string): Promise<FjordHubUser | null> {
  const result = await hubRequest('/api/hub/sso-verify', { token }, 'GET')
  if (result.ok !== true || typeof result.username !== 'string' || !result.username.trim()) return null
  return result as unknown as FjordHubUser
}

/** Brugere med adgang til appen i FjordHub. Tom liste hvis hubben ikke svarer. */
export async function listFjordHubUsers(): Promise<FjordHubUser[] | null> {
  const result = await hubRequest('/api/hub/apps/users', {}, 'GET')
  // null betyder, at hubben ikke svarede korrekt. Det er vigtigt at skelne
  // fra en gyldig, tom liste, ellers kunne et kort netværksudfald slette alle.
  if (result.ok !== true || !Array.isArray(result.items)) return null
  return (result.items as FjordHubUser[]).filter(u => typeof u.username === 'string' && u.username.trim())
}

/**
 * Sørger for at alle hub-brugere findes lokalt, så de fx kan vælges i
 * kategorideling, før de har logget ind første gang. No-op uden hub.
 */
export async function syncFjordHubUsers(): Promise<void> {
  if (!isFjordHubManaged()) return
  await migrateLegacyUsersToFjordHub()
  const hubUsers = await listFjordHubUsers()
  if (hubUsers === null) return

  for (const hubUser of hubUsers) {
    try {
      await ensureManagedLocalUser(hubUser, { recordLogin: false })
    } catch (error) {
      console.error('[fjordhub] Kunne ikke synkronisere bruger:', hubUser.username, error)
    }
  }

  // FjordHub er autoritativ for app-adgang. Fjern kun rækker, som tidligere
  // er blevet knyttet til et konkret hub-id; selvstændige/ældre lokale rækker
  // må ikke slettes ved en fejl. FK-reglerne rydder brugerens delinger og data.
  const activeHubIds = hubUsers
    .map(user => Number(user.id))
    .filter(id => Number.isSafeInteger(id) && id > 0)
  await pool.query(
    `DELETE FROM users
     WHERE fjordhub_user_id IS NOT NULL
       AND NOT (fjordhub_user_id = ANY($1::bigint[]))`,
    [activeHubIds]
  )
}

/**
 * Sørger for at hub-brugeren findes som lokal bruger, og at fornavn og
 * admin-rolle afspejler hubben. Lokale funktioner (kategorideling, pins osv.)
 * fungerer derefter helt som for almindeligt oprettede brugere.
 */
export async function ensureManagedLocalUser(
  hubUser: FjordHubUser,
  options?: { recordLogin?: boolean }
): Promise<{ id: string; isAdmin: boolean }> {
  const username = String(hubUser.username || '').trim()
  if (!username) throw new Error('FjordHub user is missing a username')
  const hubUserId = Number(hubUser.id)
  if (!Number.isSafeInteger(hubUserId) || hubUserId <= 0) {
    throw new Error('FjordHub user is missing a valid id')
  }

  const recordLogin = options?.recordLogin !== false
  const firstName = String(hubUser.first_name || '').trim() || username
  const isAdmin = (hubUser.role ?? hubUser.hub_role) === 'admin'
  const email = managedEmail(username, hubUser.email)
  const emailHash = hashEmail(email)
  const legacyEmailHash = hashEmail(managedEmail(username))

  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    // Startup sync and login can otherwise reconcile the same user at once.
    await client.query('SELECT pg_advisory_xact_lock($1::bigint)', [hubUserId])

    const existing = await client.query<{ id: string }>(
      `SELECT id FROM users
       WHERE fjordhub_user_id = $1 OR email_hash = $2 OR email_hash = $3
       ORDER BY (email_hash = $2) DESC, (fjordhub_user_id = $1) DESC, (email_hash = $3) DESC
       FOR UPDATE`,
      [hubUserId, emailHash, legacyEmailHash]
    )
    if (existing.rows[0]) {
      const targetId = existing.rows[0].id
      // Older releases could create both an email user and a
      // username@fjordhub.local user. Detach a duplicate hub identity before
      // linking the preferred email row, avoiding the unique-key failure that
      // made both SSO and password login return a generic server error.
      await client.query(
        `UPDATE users SET fjordhub_user_id = NULL, updated_at = NOW()
         WHERE fjordhub_user_id = $1 AND id <> $2`,
        [hubUserId, targetId]
      )
    // Synkronisér navn, email og rolle. En gammel @fjordhub.local-identitet
    // opgraderes på samme række, så brugerens pins og delinger bevares.
      await client.query(
        `UPDATE users SET first_name = $1, email = $2, email_hash = $3, is_admin = $4,
           fjordhub_user_id = $5,
           last_login_at = CASE WHEN $6 THEN NOW() ELSE last_login_at END,
           updated_at = NOW()
         WHERE id = $7`,
        [encrypt(firstName), encrypt(email), emailHash, isAdmin, hubUserId, recordLogin, targetId]
      )
      await client.query('COMMIT')
      return { id: targetId, isAdmin }
    }

    const created = await client.query(
      `INSERT INTO users (first_name, email, email_hash, password_hash, is_admin, must_change_password, fjordhub_user_id, last_login_at)
       VALUES ($1, $2, $3, $4, $5, FALSE, $6, CASE WHEN $7 THEN NOW() ELSE NULL END)
       RETURNING id`,
      [encrypt(firstName), encrypt(email), emailHash, MANAGED_PASSWORD_HASH, isAdmin, hubUserId, recordLogin]
    )
    await client.query('COMMIT')
    return { id: created.rows[0].id, isAdmin }
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}
