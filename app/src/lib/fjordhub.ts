import pool from './db'
import { encrypt, hashEmail } from './crypto'

export interface FjordHubUser {
  id: number
  username: string
  role?: 'admin' | 'user'
  hub_role?: 'admin' | 'user'
  first_name?: string
  last_name?: string
  language?: string
}

// Sentinel i password_hash for hub-styrede brugere: kan aldrig verificeres
// som Argon2, så lokalt password-login er automatisk blokeret for dem.
const MANAGED_PASSWORD_HASH = 'fjordhub-managed'

export function isFjordHubManaged(): boolean {
  return Boolean(
    process.env.FJORDHUB_URL &&
    process.env.FJORDHUB_APP_ID &&
    process.env.FJORDHUB_API_KEY
  )
}

/** Deterministisk pseudo-email for en hub-bruger, så email_hash kan slås op. */
function managedEmail(username: string): string {
  return `${username.trim().toLowerCase()}@fjordhub.local`
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
  const emailHash = hashEmail(managedEmail(username))

  const existing = await pool.query('SELECT id FROM users WHERE email_hash = $1', [emailHash])
  if (existing.rows[0]) {
    // Synkronisér navn og rolle fra hubben
    await pool.query(
      `UPDATE users SET first_name = $1, is_admin = $2,
         last_login_at = CASE WHEN $3 THEN NOW() ELSE last_login_at END,
         updated_at = NOW()
       WHERE id = $4`,
      [encrypt(firstName), isAdmin, recordLogin, existing.rows[0].id]
    )
    return { id: existing.rows[0].id, isAdmin }
  }

  const created = await pool.query(
    `INSERT INTO users (first_name, email, email_hash, password_hash, is_admin, must_change_password, last_login_at)
     VALUES ($1, $2, $3, $4, $5, FALSE, CASE WHEN $6 THEN NOW() ELSE NULL END)
     ON CONFLICT (email_hash) DO UPDATE SET email_hash = EXCLUDED.email_hash
     RETURNING id`,
    [encrypt(firstName), encrypt(managedEmail(username)), emailHash, MANAGED_PASSWORD_HASH, isAdmin, recordLogin]
  )
  return { id: created.rows[0].id, isAdmin }
}
