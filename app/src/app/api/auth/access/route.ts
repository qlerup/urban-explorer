import {verifyToken} from '@/lib/auth-edge'
import {hubManaged} from '@/lib/hub-access'
import {NextResponse} from 'next/server'
import {cookies} from 'next/headers'
import {getSession, COOKIE_NAME} from '@/lib/auth'
export async function GET() {
  const existing = (await cookies()).get(COOKIE_NAME)?.value
  const valid = existing ? await verifyToken(existing) : null
  try {
    const session = await getSession()
    const response = NextResponse.json({authenticated:!!session, ...(!session && valid && hubManaged() ? {error_code:'access_revoked'} : {})}, {status:!session && valid && hubManaged() ? 401 : 200})
    response.headers.set('Cache-Control','private, no-store')
    if (!session && existing) response.cookies.delete(COOKIE_NAME)
    return response
  } catch {
    return NextResponse.json({error_code:'hub_unavailable'}, {status:503})
  }
}
