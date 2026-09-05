import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { isFjordHubManaged } from '@/lib/fjordhub'
import { getSmtpSettings, sendTestEmail } from '@/lib/mail'

async function requireAdmin() {
  const session = await getSession()
  return session?.isAdmin === true
}

export async function POST(req: NextRequest) {
  if (!await requireAdmin()) return NextResponse.json({ error: 'Ingen adgang' }, { status: 403 })
  if (isFjordHubManaged()) {
    return NextResponse.json({ error: 'Mail indstilles i FjordHub' }, { status: 400 })
  }
  try {
    const body = await req.json()
    let password = String(body.password || '')
    if (!password) {
      // Blank means "keep the currently saved one" (mirrors saveSmtpSettings).
      const existing = await getSmtpSettings()
      password = existing?.password || ''
    }
    await sendTestEmail({
      user: body.user,
      password,
      host: body.host,
      port: body.port,
      fromAddress: body.fromAddress,
      testTo: body.testTo,
    })
    return NextResponse.json({ ok: true })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Kunne ikke sende testmailen' },
      { status: 400 }
    )
  }
}
