import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { addImportCandidates, type NewImportCandidate } from '@/lib/importCandidates'

export async function POST(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Ingen adgang' }, { status: 401 })

  const body = await req.json()
  if (!Array.isArray(body.items)) {
    return NextResponse.json({ error: 'Mangler pins at importere' }, { status: 400 })
  }

  const items: NewImportCandidate[] = []
  for (const item of body.items) {
    const lat = Number(item?.lat)
    const lng = Number(item?.lng)
    if (!Number.isFinite(lat) || lat < -90 || lat > 90 || !Number.isFinite(lng) || lng < -180 || lng > 180) continue
    items.push({
      name: typeof item.name === 'string' ? item.name.trim().slice(0, 200) : '',
      description: typeof item.description === 'string' ? item.description.slice(0, 2000) : '',
      lat,
      lng,
    })
  }
  if (items.length === 0) {
    return NextResponse.json({ error: 'Ingen gyldige pins at importere' }, { status: 400 })
  }
  if (items.length > 2000) {
    return NextResponse.json({ error: 'Der kan højst importeres 2.000 pins ad gangen' }, { status: 400 })
  }

  await addImportCandidates(session.userId, items)
  return NextResponse.json({ success: true, count: items.length })
}
