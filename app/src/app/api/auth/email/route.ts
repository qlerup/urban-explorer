import {NextRequest, NextResponse} from 'next/server'
import {getSession, getHubIdentity} from '@/lib/auth'
import {hubManaged, hubMember, clearHubAccess} from '@/lib/hub-access'
import {hubRequest} from '@/lib/fjordhub'

export async function POST(request: NextRequest) {
  try {
    const origin = new URL(request.headers.get('origin') || '')
    if (!['http:', 'https:'].includes(origin.protocol) || origin.host.toLowerCase() !== request.headers.get('host')?.toLowerCase() || request.headers.get('sec-fetch-site') === 'cross-site')
      return NextResponse.json({ok:false, error:'Invalid request origin'}, {status:403})
  } catch { return NextResponse.json({ok:false, error:'Invalid request origin'}, {status:403}) }
  try {
    const session = await getSession({allowEmailRequired:true})
    if (!session || !hubManaged()) return NextResponse.json({ok:false}, {status:401})
    const member = await hubMember(await getHubIdentity(session), true)
    if (!member) return NextResponse.json({ok:false, error_code:'access_revoked'}, {status:401})
    const data = await request.json().catch(() => null)
    if (!data || typeof data.email !== 'string' || data.email.length > 254)
      return NextResponse.json({ok:false, error:'Invalid email'}, {status:400})
    const result = await hubRequest(`/api/hub/apps/users/${member.id}/email`, {email:data.email})
    clearHubAccess()
    return NextResponse.json(result, {headers:{'Cache-Control':'private, no-store'}})
  } catch { return NextResponse.json({ok:false, error:'FjordHub unavailable'}, {status:503}) }
}
