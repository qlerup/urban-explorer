import { NextRequest, NextResponse } from 'next/server'
import pool from '@/lib/db'
import { hashPassword } from '@/lib/auth'
import { encrypt, hashEmail, normalizeEmail } from '@/lib/crypto'

export async function GET() {
  try {
    const result = await pool.query('SELECT COUNT(*)::int AS count FROM users')
    return NextResponse.json({ setupRequired: result.rows[0].count === 0 })
  } catch {
    return NextResponse.json({ error: 'Databasefejl' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const countResult = await pool.query('SELECT COUNT(*)::int AS count FROM users')
    if (countResult.rows[0].count > 0) {
      return NextResponse.json({ error: 'Opsætning er allerede gennemført' }, { status: 400 })
    }

    const body = await req.json()
    const { firstName, email, password, confirmPassword } = body

    if (!firstName?.trim() || !email?.trim() || !password) {
      return NextResponse.json({ error: 'Alle felter er påkrævet' }, { status: 400 })
    }

    const emailClean = normalizeEmail(email)
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailClean)) {
      return NextResponse.json({ error: 'Ugyldig email-adresse' }, { status: 400 })
    }

    if (password !== confirmPassword) {
      return NextResponse.json({ error: 'Adgangskoderne stemmer ikke overens' }, { status: 400 })
    }

    if (password.length < 12) {
      return NextResponse.json({ error: 'Adgangskoden skal være mindst 12 tegn' }, { status: 400 })
    }

    const passwordHash = await hashPassword(password)

    await pool.query(
      'INSERT INTO users (first_name, email, email_hash, password_hash, is_admin) VALUES ($1, $2, $3, $4, TRUE)',
      [encrypt(firstName.trim()), encrypt(emailClean), hashEmail(emailClean), passwordHash]
    )

    return NextResponse.json({ success: true })
  } catch {
    return NextResponse.json({ error: 'Serverfejl under opsætning' }, { status: 500 })
  }
}
