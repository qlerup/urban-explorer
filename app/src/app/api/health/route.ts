import { NextResponse } from 'next/server'
import pool from '@/lib/db'

export async function GET() {
  try {
    await pool.query('SELECT 1')
    return NextResponse.json({ ok: true, service: 'urban-explorer', database: 'connected' })
  } catch {
    return NextResponse.json(
      { ok: false, service: 'urban-explorer', database: 'unavailable' },
      { status: 503 }
    )
  }
}
