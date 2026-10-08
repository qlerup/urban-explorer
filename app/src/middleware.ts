import {hubAccess, hubManaged} from '@/lib/hub-access'
import { NextRequest, NextResponse } from 'next/server'
import { verifyToken, COOKIE_NAME } from '@/lib/auth-edge'

const PUBLIC_PATHS = ['/hub-session.js', '/hub-session.css', '/api/auth/access', '/', '/login', '/glemt-adgangskode', '/setup', '/api/setup', '/api/auth/login', '/api/auth/change-password', '/api/auth/password-reset', '/api/cadastre', '/share', '/api/share', '/hub-login', '/api/health']
const CHANGE_PASSWORD_PATHS = ['/skift-adgangskode', '/api/auth/change-password', '/api/auth/logout']

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl

  if (PUBLIC_PATHS.some(p => pathname === p || pathname.startsWith(p + '/'))) {
    return NextResponse.next()
  }

  const token = req.cookies.get(COOKIE_NAME)?.value
  if (!token) {
    return NextResponse.redirect(new URL('/login', req.url))
  }

  const session = await verifyToken(token)
  if (!session) {
    const response = NextResponse.redirect(new URL('/login', req.url))
    response.cookies.delete(COOKIE_NAME)
    return response
  }

  const bypassesPasswordChange = CHANGE_PASSWORD_PATHS.some(p => pathname === p || pathname.startsWith(p + '/'))
  if (session.mustChangePassword && !bypassesPasswordChange) {
    if (pathname.startsWith('/api/')) {
      return NextResponse.json({ error: 'Du skal vælge en ny adgangskode først' }, { status: 403 })
    }
    return NextResponse.redirect(new URL('/skift-adgangskode', req.url))
  }

  if (hubManaged() && session.hubUserId) {
    const status = await hubAccess({id:session.hubUserId})
    if (status === 'unavailable') return NextResponse.json({error_code:'hub_unavailable'}, {status:503})
    if (status === 'revoked') {
      const response = pathname.startsWith('/api/')
        ? NextResponse.json({error_code:'access_revoked', authenticated:false}, {status:401})
        : NextResponse.redirect(new URL('/login?access_removed=1', req.url))
      response.cookies.delete(COOKIE_NAME)
      response.headers.set('Cache-Control','no-store')
      return response
    }
  }
  return NextResponse.next()
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.png|.*\\.jpg|.*\\.jpeg|.*\\.svg|.*\\.ico|.*\\.webp|.*\\.webmanifest).*)'],
}
