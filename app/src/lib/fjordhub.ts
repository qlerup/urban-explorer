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

export async function verifyFjordHubSsoToken(token: string): Promise<FjordHubUser | null> {
  const result = await hubRequest('/api/hub/sso-verify', { token }, 'GET')
  if (result.ok !== true || typeof result.username !== 'string' || !result.username.trim()) return null
  return result as unknown as FjordHubUser
}

/** Brugere med adgang til appen i FjordHub. Tom liste hvis hubben ikke svarer. */
export async function listFjordHubUsers(): Promise<FjordHubUser[]> {
  const result = await hubRequest('/api/hub/apps/users', {}, 'GET')
  if (result.ok !== true || !Array.isArray(result.items)) return []
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
  for (const hubUser of hubUsers) {
    try {
      await ensureManagedLocalUser(hubUser, { recordLogin: false })
    } catch (error) {
      console.error('[fjordhub] Kunne ikke synkronisere bruger:', hubUser.username, error)
    }
  }
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

  const recordLogin = options?.recordLogin !== false
  const firstName = String(hubUser.first_name || '').trim() || username
  const isAdmin = (hubUser.role ?? hubUser.hub_role) === 'admin'
  const email = managedEmail(username, hubUser.email)
  const emailHash = hashEmail(email)
  const legacyEmailHash = hashEmail(managedEmail(username))

  const existing = await pool.query(
    'SELECT id FROM users WHERE email_hash = $1 OR email_hash = $2 ORDER BY (email_hash = $1) DESC LIMIT 1',
    [emailHash, legacyEmailHash]
  )
  if (existing.rows[0]) {
    // Synkronisér navn, email og rolle. En gammel @fjordhub.local-identitet
    // opgraderes på samme række, så brugerens pins og delinger bevares.
    await pool.query(
      `UPDATE users SET first_name = $1, email = $2, email_hash = $3, is_admin = $4,
         last_login_at = CASE WHEN $5 THEN NOW() ELSE last_login_at END,
         updated_at = NOW()
       WHERE id = $6`,
      [encrypt(firstName), encrypt(email), emailHash, isAdmin, recordLogin, existing.rows[0].id]
    )
    return { id: existing.rows[0].id, isAdmin }
  }

  const created = await pool.query(
    `INSERT INTO users (first_name, email, email_hash, password_hash, is_admin, must_change_password, last_login_at)
     VALUES ($1, $2, $3, $4, $5, FALSE, CASE WHEN $6 THEN NOW() ELSE NULL END)
     ON CONFLICT (email_hash) DO UPDATE SET email_hash = EXCLUDED.email_hash
     RETURNING id`,
    [encrypt(firstName), encrypt(email), emailHash, MANAGED_PASSWORD_HASH, isAdmin, recordLogin]
  )
  return { id: created.rows[0].id, isAdmin }
}
