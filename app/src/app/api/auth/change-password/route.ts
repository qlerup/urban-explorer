import { NextRequest, NextResponse } from 'next/server'
import pool from '@/lib/db'
import { getSession, hashPassword, createToken, COOKIE_NAME } from '@/lib/auth'

export async function POST(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Ingen adgang' }, { status: 401 })

  const body = await req.json()
  const { password, confirmPassword } = body

  if (!password || password !== confirmPassword) {
    return NextResponse.json({ error: 'Adgangskoderne stemmer ikke overens' }, { status: 400 })
  }

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
