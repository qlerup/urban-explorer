import { NextRequest, NextResponse } from 'next/server'
import pool from '@/lib/db'
import { verifyPassword, runDummyVerify, createToken, COOKIE_NAME } from '@/lib/auth'
import { hashEmail, normalizeEmail } from '@/lib/crypto'
import {
  authenticateWithFjordHub,
  ensureManagedLocalUser,
  isFjordHubManaged,
  migrateLegacyUsersToFjordHub,
} from '@/lib/fjordhub'

const MAX_ATTEMPTS = 5
const LOCK_MINUTES = 15

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { email, password } = body

    if (!email || !password) {
      return NextResponse.json({ error: 'Email og adgangskode er påkrævet' }, { status: 400 })
    }

    if (isFjordHubManaged()) {
      // Login styres af FjordHub: feltet er hub-brugernavnet
      await migrateLegacyUsersToFjordHub()
      const hubUser = await authenticateWithFjordHub(String(email).trim(), password)
      if (!hubUser) {
        return NextResponse.json(
          { error: 'Forkert login eller ingen adgang til Urban Explorer i FjordHub' },
          { status: 401 }
        )
      }
      if (hubUser.must_change_password) {
        // Første login efter oprettelse: brugeren skal selv vælge en ny adgangskode
        return NextResponse.json(
          { passwordChangeRequired: true, error: 'Du skal vælge en ny adgangskode før du kan logge ind' },
          { status: 403 }
        )
      }
      const user = await ensureManagedLocalUser(hubUser)
      const token = await createToken({
        userId: user.id,
        isAdmin: user.isAdmin,
        mustChangePassword: false,
      })
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

    const emailClean = normalizeEmail(email)
    const result = await pool.query(
      'SELECT id, password_hash, is_admin, must_change_password, failed_attempts, locked_until FROM users WHERE email_hash = $1',
      [hashEmail(emailClean)]
    )

    const user = result.rows[0]

    if (!user) {
      await runDummyVerify()
      return NextResponse.json({ error: 'Forkert email eller adgangskode' }, { status: 401 })
    }

    if (user.locked_until && new Date(user.locked_until) > new Date()) {
      return NextResponse.json(
        { error: 'Kontoen er midlertidigt låst', lockedUntil: user.locked_until },
        { status: 423 }
      )
    }

    const valid = await verifyPassword(user.password_hash, password)

    if (!valid) {
      const newAttempts = (user.failed_attempts ?? 0) + 1

      if (newAttempts >= MAX_ATTEMPTS) {
        const lockedUntil = new Date(Date.now() + LOCK_MINUTES * 60 * 1000)
        await pool.query(
          'UPDATE users SET failed_attempts = $1, locked_until = $2 WHERE id = $3',
          [newAttempts, lockedUntil, user.id]
        )
        return NextResponse.json(
          { error: `For mange fejlforsøg. Kontoen er låst i ${LOCK_MINUTES} minutter.`, lockedUntil: lockedUntil.toISOString() },
          { status: 423 }
        )
      }

      await pool.query('UPDATE users SET failed_attempts = $1 WHERE id = $2', [newAttempts, user.id])

      const left = MAX_ATTEMPTS - newAttempts
      return NextResponse.json(
        { error: `Forkert adgangskode. ${left} forsøg tilbage.`, attemptsLeft: left },
        { status: 401 }
      )
    }

    await pool.query(
      'UPDATE users SET failed_attempts = 0, locked_until = NULL, last_login_at = NOW() WHERE id = $1',
      [user.id]
    )

    const token = await createToken({
      userId: user.id,
      isAdmin: user.is_admin === true,
      mustChangePassword: user.must_change_password === true,
    })

    const response = NextResponse.json({ success: true })
    response.cookies.set(COOKIE_NAME, token, {
      httpOnly: true,
      sameSite: 'strict',
      secure: process.env.NODE_ENV === 'production',
      maxAge: 12 * 60 * 60,
      path: '/',
    })

    return response
  } catch {
    return NextResponse.json({ error: 'Serverfejl' }, { status: 500 })
  }
}
