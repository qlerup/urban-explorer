import { NextRequest, NextResponse } from 'next/server'
import pool from '@/lib/db'
import { getSession, hashPassword, createToken, COOKIE_NAME } from '@/lib/auth'
import { changeFjordHubPassword, ensureManagedLocalUser, isFjordHubManaged } from '@/lib/fjordhub'

export async function POST(req: NextRequest) {
  const body = await req.json()
  const { password, confirmPassword } = body

  if (!password || password !== confirmPassword) {
    return NextResponse.json({ error: 'Adgangskoderne stemmer ikke overens' }, { status: 400 })
  }

  if (isFjordHubManaged()) {
    // Første login for en hub-bruger: ingen session endnu - verificér via
    // brugernavn + nuværende (midlertidige) adgangskode hos FjordHub.
    const username = typeof body.username === 'string' ? body.username.trim() : ''
    const currentPassword = typeof body.currentPassword === 'string' ? body.currentPassword : ''
    if (!username || !currentPassword) {
      return NextResponse.json({ error: 'Brugernavn og nuværende adgangskode er påkrævet' }, { status: 400 })
    }
    if (password.length < 6) {
      return NextResponse.json({ error: 'Adgangskoden skal være mindst 6 tegn' }, { status: 400 })
    }
    if (password === currentPassword) {
      return NextResponse.json({ error: 'Den nye adgangskode skal være forskellig fra den nuværende' }, { status: 400 })
    }

    const { user: hubUser, error } = await changeFjordHubPassword(username, currentPassword, password)
    if (!hubUser) {
      return NextResponse.json(
        { error: error || 'Kunne ikke skifte adgangskoden i FjordHub' },
        { status: 401 }
      )
    }

    // Koden er skiftet - log brugeren ind med det samme
    const user = await ensureManagedLocalUser(hubUser)
    const token = await createToken({ userId: user.id, isAdmin: user.isAdmin, mustChangePassword: false })
    const response = NextResponse.json({ success: true })
    response.cookies.set(COOKIE_NAME, token, {
      httpOnly: true,
      sameSite: 'strict',
      secure: process.env.NODE_ENV === 'production',
      maxAge: 12 * 60 * 60,
      path: '/',
    })
    return response
  }

  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Ingen adgang' }, { status: 401 })

  if (password.length < 12) {
    return NextResponse.json({ error: 'Adgangskoden skal være mindst 12 tegn' }, { status: 400 })
  }

  const passwordHash = await hashPassword(password)

  await pool.query(
    'UPDATE users SET password_hash = $1, must_change_password = FALSE, updated_at = NOW() WHERE id = $2',
    [passwordHash, session.userId]
  )

  const token = await createToken({ userId: session.userId, isAdmin: session.isAdmin, mustChangePassword: false })

  const response = NextResponse.json({ success: true })
  response.cookies.set(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'strict',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 12 * 60 * 60,
    path: '/',
  })

  return response
}
