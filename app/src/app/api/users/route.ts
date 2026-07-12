import { NextRequest, NextResponse } from 'next/server'
import pool from '@/lib/db'
import { getSession, hashPassword } from '@/lib/auth'
import { encrypt, hashEmail, normalizeEmail } from '@/lib/crypto'
import { listUsers } from '@/lib/users'
import { syncFjordHubUsers } from '@/lib/fjordhub'

export async function GET() {
  const session = await getSession()
  if (!session || !session.isAdmin) return NextResponse.json({ error: 'Ingen adgang' }, { status: 403 })

  await syncFjordHubUsers()
  const users = await listUsers()
  return NextResponse.json({ users })
}

export async function POST(req: NextRequest) {
  const session = await getSession()
  if (!session || !session.isAdmin) return NextResponse.json({ error: 'Ingen adgang' }, { status: 403 })

  const body = await req.json()
  const { firstName, email, password, isAdmin } = body

  if (!firstName?.trim() || !email?.trim() || !password) {
    return NextResponse.json({ error: 'Alle felter er påkrævet' }, { status: 400 })
  }

  const emailClean = normalizeEmail(email)
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailClean)) {
    return NextResponse.json({ error: 'Ugyldig email-adresse' }, { status: 400 })
  }

  if (password.length < 12) {
    return NextResponse.json({ error: 'Adgangskoden skal være mindst 12 tegn' }, { status: 400 })
  }

  const passwordHash = await hashPassword(password)

  const result = await pool.query(
    'INSERT INTO users (first_name, email, email_hash, password_hash, is_admin, must_change_password) VALUES ($1, $2, $3, $4, $5, TRUE) RETURNING id',
    [encrypt(firstName.trim()), encrypt(emailClean), hashEmail(emailClean), passwordHash, isAdmin === true]
  ).catch((err: { code?: string }) => {
    if (err.code === '23505') return null
    throw err
  })

  if (!result) {
    return NextResponse.json({ error: 'Der findes allerede en bruger med den email' }, { status: 400 })
  }

  return NextResponse.json({ success: true, id: result.rows[0].id })
}
