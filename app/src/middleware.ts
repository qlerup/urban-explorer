import { NextRequest, NextResponse } from 'next/server'
import { verifyToken, COOKIE_NAME } from '@/lib/auth-edge'

const PUBLIC_PATHS = ['/', '/login', '/setup', '/api/setup', '/api/auth/login', '/api/cadastre', '/share', '/api/share', '/hub-login', '/api/health']
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

  return NextResponse.next()
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.png|.*\\.jpg|.*\\.jpeg|.*\\.svg|.*\\.ico|.*\\.webp|.*\\.webmanifest).*)'],
}
