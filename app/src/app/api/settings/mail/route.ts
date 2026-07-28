import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { isFjordHubManaged } from '@/lib/fjordhub'
import { getSmtpSettings, saveSmtpSettings } from '@/lib/mail'

async function requireAdmin() {
  const session = await getSession()
  return session?.isAdmin === true
}

export async function GET() {
  if (!await requireAdmin()) return NextResponse.json({ error: 'Ingen adgang' }, { status: 403 })
  if (isFjordHubManaged()) {
    return NextResponse.json({ hubManaged: true, configured: true })
  }
  const settings = await getSmtpSettings()
  return NextResponse.json({
    hubManaged: false,
    configured: Boolean(settings),
    user: settings?.user || '',
    host: settings?.host || 'smtp.gmail.com',
    port: settings?.port || 465,
  })
}

export async function PUT(req: NextRequest) {
  if (!await requireAdmin()) return NextResponse.json({ error: 'Ingen adgang' }, { status: 403 })
  if (isFjordHubManaged()) {
    return NextResponse.json({ error: 'Mail indstilles i FjordHub' }, { status: 400 })
  }
  try {
    const body = await req.json()
    await saveSmtpSettings(body)
    return NextResponse.json({ ok: true })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Kunne ikke gemme mailopsætningen' },
      { status: 400 }
    )
  }
}
