import { NextRequest, NextResponse } from 'next/server'
import { COOKIE_NAME, createToken } from '@/lib/auth'
import { ensureManagedLocalUser, isFjordHubManaged, verifyFjordHubSsoToken } from '@/lib/fjordhub'

function redirectUrl(req: NextRequest, path: string): URL {
  const forwardedHost = req.headers.get('x-forwarded-host')?.split(',')[0]?.trim()
  const host = forwardedHost || req.headers.get('host')
  const forwardedProto = req.headers.get('x-forwarded-proto')?.split(',')[0]?.trim()
  const protocol = forwardedProto === 'https' ? 'https' : forwardedProto === 'http' ? 'http' : req.nextUrl.protocol.replace(':', '')
  return host ? new URL(path, `${protocol}://${host}`) : new URL(path, req.url)
}

export async function GET(req: NextRequest) {
  if (!isFjordHubManaged()) return NextResponse.redirect(redirectUrl(req, '/login'))

  const token = req.nextUrl.searchParams.get('token')?.trim() || ''
  if (!token) return NextResponse.redirect(redirectUrl(req, '/login?error=hub-token'))

  const hubUser = await verifyFjordHubSsoToken(token)
  if (!hubUser) return NextResponse.redirect(redirectUrl(req, '/login?error=hub-login'))

  try {
    const user = await ensureManagedLocalUser(hubUser)
    const sessionToken = await createToken({
      userId: user.id,
      isAdmin: user.isAdmin,
      mustChangePassword: false,
    })
    const response = NextResponse.redirect(redirectUrl(req, '/dashboard/kort'))
    // SameSite=lax (ikke strict): SSO-navigationen kommer fra hubbens domæne,
    // og en strict-cookie ville ikke blive sendt med på selve redirect-kæden.
    response.cookies.set(COOKIE_NAME, sessionToken, {
      httpOnly: true,
      sameSite: 'lax',
      secure: req.nextUrl.protocol === 'https:',
      maxAge: 12 * 60 * 60,
      path: '/',
    })
    return response
  } catch (error) {
    // Samme mønster som de andre Fjord-apps: log fejlen og send pænt til login
    console.error('[hub-login] FjordHub SSO-login fejlede:', error)
    return NextResponse.redirect(redirectUrl(req, '/login?error=hub-login'))
  }
}
