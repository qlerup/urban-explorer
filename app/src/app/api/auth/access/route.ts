import {verifyToken} from '@/lib/auth-edge'
import {hubManaged, hubMember} from '@/lib/hub-access'
import {NextRequest, NextResponse} from 'next/server'
import {cookies} from 'next/headers'
import {getSession, getHubIdentity, COOKIE_NAME} from '@/lib/auth'
export async function GET(request: NextRequest) {
  const existing = (await cookies()).get(COOKIE_NAME)?.value
  const valid = existing ? await verifyToken(existing) : null
  try {
    const session = await getSession({allowEmailRequired:true})
    if (session && hubManaged()) {
      const member = await hubMember(await getHubIdentity(session), request.nextUrl.searchParams.get('fresh') === '1')
      if (!member) {
        const response = NextResponse.json({authenticated:false, error_code:'access_revoked'}, {status:401})
        response.cookies.delete(COOKIE_NAME)
        return response
      }
      if (member?.email_required) return NextResponse.json({authenticated:true, email_required:true, error_code:'email_update_required'}, {status:403, headers:{'Cache-Control':'private, no-store'}})
    }
    const response = NextResponse.json({authenticated:!!session, ...(!session && valid && hubManaged() ? {error_code:'access_revoked'} : {})}, {status:!session && valid && hubManaged() ? 401 : 200})
    response.headers.set('Cache-Control','private, no-store')
    if (!session && existing) response.cookies.delete(COOKIE_NAME)
    return response
  } catch {
    return NextResponse.json({error_code:'hub_unavailable'}, {status:503})
  }
}
