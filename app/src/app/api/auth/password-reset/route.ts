import { randomBytes, randomInt, randomUUID, timingSafeEqual } from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import pool from '@/lib/db'
import { hashPassword, runDummyVerify } from '@/lib/auth'
import { hashEmail, keyedHash, normalizeEmail } from '@/lib/crypto'
import {
  completeFjordHubPasswordReset,
  isFjordHubManaged,
  requestFjordHubPasswordReset,
  verifyFjordHubPasswordReset,
} from '@/lib/fjordhub'
import { sendPasswordResetCode } from '@/lib/mail'

const GENERIC_MESSAGE = 'Hvis email-adressen findes, er sikkerhedskoden sendt.'

function sameHash(left: string, right: string): boolean {
  const a = Buffer.from(left)
  const b = Buffer.from(right)
  return a.length === b.length && timingSafeEqual(a, b)
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}))
  const action = String(body.action || '')

  if (action === 'request') {
    const email = normalizeEmail(String(body.email || ''))
    if (isFjordHubManaged()) {
      const result = await requestFjordHubPasswordReset(email)
      return NextResponse.json({ ok: true, message: GENERIC_MESSAGE, challengeId: result.challengeId || randomUUID() })
    }

    const fallbackId = randomUUID()
    if (!email) return NextResponse.json({ ok: true, message: GENERIC_MESSAGE, challengeId: fallbackId })
    const userResult = await pool.query('SELECT id FROM users WHERE email_hash = $1', [hashEmail(email)])
    const user = userResult.rows[0]
    if (!user) {
      await runDummyVerify()
      return NextResponse.json({ ok: true, message: GENERIC_MESSAGE, challengeId: fallbackId })
    }

    const recent = await pool.query(
      `SELECT id FROM password_reset_challenges
       WHERE user_id = $1 AND used_at IS NULL AND expires_at > NOW()
       ORDER BY created_at DESC LIMIT 1`,
      [user.id]
    )
    if (
      recent.rows[0] &&
      (await pool.query(
        `SELECT 1 FROM password_reset_challenges
         WHERE id = $1 AND created_at > NOW() - INTERVAL '60 seconds'`,
        [recent.rows[0].id]
      )).rows[0]
    ) {
      return NextResponse.json({ ok: true, message: GENERIC_MESSAGE, challengeId: recent.rows[0].id })
    }
    const hourly = await pool.query(
      `SELECT COUNT(*)::int AS count FROM password_reset_challenges
       WHERE user_id = $1 AND created_at > NOW() - INTERVAL '1 hour'`,
      [user.id]
    )
    if (hourly.rows[0].count >= 5) {
      return NextResponse.json({
        ok: true,
        message: GENERIC_MESSAGE,
        challengeId: recent.rows[0]?.id || fallbackId,
      })
    }

    const challengeId = randomUUID()
    const code = String(randomInt(0, 1_000_000)).padStart(6, '0')
    await pool.query(
      `INSERT INTO password_reset_challenges (id, user_id, code_hash, expires_at)
       VALUES ($1, $2, $3, NOW() + INTERVAL '5 minutes')`,
      [challengeId, user.id, keyedHash(`${challengeId}:${code}`)]
    )
    try {
      await sendPasswordResetCode(email, code)
    } catch (error) {
      console.error('[password-reset] Mail kunne ikke sendes:', error)
    }
    return NextResponse.json({ ok: true, message: GENERIC_MESSAGE, challengeId })
  }

  if (action === 'verify') {
    const challengeId = String(body.challengeId || '')
    const code = String(body.code || '').replace(/\D/g, '').slice(0, 6)
    if (isFjordHubManaged()) {
      const result = await verifyFjordHubPasswordReset(challengeId, code)
      if (!result.resetToken) return NextResponse.json({ error: result.error }, { status: 400 })
      return NextResponse.json({ ok: true, resetToken: result.resetToken })
    }

    const result = await pool.query(
      `SELECT code_hash FROM password_reset_challenges
       WHERE id = $1 AND used_at IS NULL AND verified_at IS NULL
         AND expires_at > NOW() AND attempts < 5`,
      [challengeId]
    )
    const challenge = result.rows[0]
    const candidate = keyedHash(`${challengeId}:${code}`)
    if (!challenge || !sameHash(challenge.code_hash, candidate)) {
      if (challenge) {
        await pool.query('UPDATE password_reset_challenges SET attempts = attempts + 1 WHERE id = $1', [challengeId])
      }
      return NextResponse.json({ error: 'Koden er ugyldig eller udløbet' }, { status: 400 })
    }
    const resetToken = randomBytes(32).toString('base64url')
    await pool.query(
      `UPDATE password_reset_challenges
       SET verified_at = NOW(), reset_token_hash = $2 WHERE id = $1`,
      [challengeId, keyedHash(`${challengeId}:${resetToken}`)]
    )
    return NextResponse.json({ ok: true, resetToken })
  }

  if (action === 'complete') {
    const challengeId = String(body.challengeId || '')
    const resetToken = String(body.resetToken || '')
    const password = String(body.password || '')
    const confirmPassword = String(body.confirmPassword || '')
    if (password !== confirmPassword) {
      return NextResponse.json({ error: 'De to adgangskoder matcher ikke' }, { status: 400 })
    }
    const minimum = isFjordHubManaged() ? 6 : 12
    if (password.length < minimum) {
      return NextResponse.json({ error: `Adgangskoden skal være mindst ${minimum} tegn` }, { status: 400 })
    }
    if (isFjordHubManaged()) {
      const result = await completeFjordHubPasswordReset(challengeId, resetToken, password)
      return NextResponse.json(result, { status: result.ok ? 200 : 400 })
    }

    const result = await pool.query(
      `SELECT user_id, reset_token_hash FROM password_reset_challenges
       WHERE id = $1 AND verified_at IS NOT NULL AND used_at IS NULL AND expires_at > NOW()`,
      [challengeId]
    )
    const challenge = result.rows[0]
    const candidate = keyedHash(`${challengeId}:${resetToken}`)
    if (!challenge?.reset_token_hash || !sameHash(challenge.reset_token_hash, candidate)) {
      return NextResponse.json({ error: 'Nulstillingen er ugyldig eller udløbet' }, { status: 400 })
    }
    const passwordHash = await hashPassword(password)
    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      await client.query(
        `UPDATE users SET password_hash = $1, must_change_password = FALSE,
         failed_attempts = 0, locked_until = NULL, updated_at = NOW() WHERE id = $2`,
        [passwordHash, challenge.user_id]
      )
      await client.query('UPDATE password_reset_challenges SET used_at = NOW() WHERE id = $1', [challengeId])
      await client.query(
        'UPDATE password_reset_challenges SET used_at = NOW() WHERE user_id = $1 AND used_at IS NULL',
        [challenge.user_id]
      )
      await client.query('COMMIT')
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    } finally {
      client.release()
    }
    return NextResponse.json({ ok: true })
  }

  return NextResponse.json({ error: 'Ugyldig handling' }, { status: 400 })
}
