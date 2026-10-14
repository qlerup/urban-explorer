/** Request-time app membership; failures never authorize a stale session. */
export type Identity = { id?: number; username?: string }
export type HubMember = {id:number; username:string; email_required?:boolean}
type Snapshot = {key:string; expires:number; users:HubMember[]}
let snapshot: Snapshot | null = null
let pending: Promise<Snapshot> | null = null
export function hubManaged() { return Boolean(process.env.FJORDHUB_URL && process.env.FJORDHUB_APP_ID && process.env.FJORDHUB_API_KEY) }
export function clearHubAccess() { snapshot = null }
export async function hubMember(identity: Identity, force = false): Promise<HubMember | null> {
  const key = [process.env.FJORDHUB_URL, process.env.FJORDHUB_APP_ID, process.env.FJORDHUB_API_KEY].join('|')
  if (force) snapshot = null
  if (!snapshot || snapshot.key !== key || snapshot.expires <= Date.now()) {
    if (!pending) pending = (async () => {
      const url = new URL('/api/hub/apps/users', process.env.FJORDHUB_URL)
      url.searchParams.set('app_id', process.env.FJORDHUB_APP_ID || '')
      const response = await fetch(url, {cache:'no-store', headers:{'X-Hub-Key':process.env.FJORDHUB_API_KEY || ''}, signal:AbortSignal.timeout(6000)})
      const result = await response.json()
      if (!response.ok || result.ok !== true || !Array.isArray(result.items)) throw new Error('Hub unavailable')
      snapshot = {key, expires:Date.now()+5000, users:result.items}
      return snapshot
    })().finally(() => { pending = null })
    await pending
  }
  const found = snapshot?.users.find(user => identity.id !== undefined ? user.id === identity.id : !!identity.username && user.username.toLowerCase() === identity.username.toLowerCase())
  if (!found) snapshot = null // Fresh access grants must not inherit a negative cache.
  return found || null
}
export async function hubAccess(identity: Identity): Promise<'allowed' | 'email_required' | 'revoked' | 'unavailable'> {
  try {
    const member = await hubMember(identity)
    return !member ? 'revoked' : member.email_required ? 'email_required' : 'allowed'
  } catch { return 'unavailable' }
}
