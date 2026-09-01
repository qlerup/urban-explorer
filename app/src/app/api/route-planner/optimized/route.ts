import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'

export const dynamic = 'force-dynamic'

const DEFAULT_VALHALLA_URL = 'https://valhalla1.openstreetmap.de'
const MAX_STOPS = 50

interface InputStop {
  id: string
  lat: number
  lng: number
}

interface ValhallaLocation {
  original_index?: number
}

interface ValhallaLeg {
  shape?: string
}

interface ValhallaResponse {
  error?: string
  error_code?: number
  status_code?: number
  status?: string
  locations?: ValhallaLocation[]
  trip?: {
    locations?: ValhallaLocation[]
    legs?: ValhallaLeg[]
    summary?: {
      length?: number
      time?: number
    }
  }
}

function isValidStop(value: unknown): value is InputStop {
  if (!value || typeof value !== 'object') return false
  const stop = value as Partial<InputStop>
  return typeof stop.id === 'string'
    && stop.id.length > 0
    && Number.isFinite(stop.lat)
    && Number.isFinite(stop.lng)
    && stop.lat! >= -90
    && stop.lat! <= 90
    && stop.lng! >= -180
    && stop.lng! <= 180
}

async function requestValhalla(action: 'route' | 'optimized_route', payload: object): Promise<Response> {
  const baseUrl = (process.env.VALHALLA_URL || DEFAULT_VALHALLA_URL).replace(/\/$/, '')
  const endpoint = `${baseUrl}/${action}`

  // Valhalla supports JSON requests. POST keeps URLs short when many pins are selected.
  let response = await fetch(endpoint, {
    method: 'POST',
    cache: 'no-store',
    headers: {
      'Content-Type': 'application/json',
      'X-Client-Id': 'urban-explorer',
    },
    body: JSON.stringify(payload),
  })

  // A few hosted Valhalla setups expose optimized_route as GET-only. Fall back
  // to the documented ?json= form if POST is rejected.
  if (response.status === 404 || response.status === 405) {
    const url = new URL(endpoint)
    url.searchParams.set('json', JSON.stringify(payload))
    response = await fetch(url, {
      cache: 'no-store',
      headers: { 'X-Client-Id': 'urban-explorer' },
    })
  }

  return response
}

export async function POST(request: NextRequest) {
  if (!(await getSession())) return new NextResponse(null, { status: 401 })

  let body: { stops?: unknown }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Ugyldig forespørgsel' }, { status: 400 })
  }

  if (!Array.isArray(body.stops) || body.stops.length < 2) {
    return NextResponse.json({ error: 'Vælg mindst 2 pins' }, { status: 400 })
  }
  if (body.stops.length > MAX_STOPS) {
    return NextResponse.json({ error: `Der kan højst vælges ${MAX_STOPS} pins ad gangen` }, { status: 400 })
  }
  if (!body.stops.every(isValidStop)) {
    return NextResponse.json({ error: 'En eller flere pins har ugyldige koordinater' }, { status: 400 })
  }

  const stops = body.stops as InputStop[]
  const payload = {
    locations: stops.map(stop => ({ lat: stop.lat, lon: stop.lng, type: 'break' })),
    costing: 'auto',
    // Valhalla bruger kilometer som standard. directions_options holder også
    // den almindelige route-respons i kilometer.
    directions_options: { units: 'kilometers' },
  }

  // Valhallas optimized_route kræver mindst fire locations. Med 2-3 stops er
  // der reelt ingen/marginal rækkefølge at optimere, så vi bruger almindelig bilrute.
  const action = stops.length >= 4 ? 'optimized_route' : 'route'

  try {
    const upstream = await requestValhalla(action, payload)
    const text = await upstream.text()
    let data: ValhallaResponse
    try {
      data = JSON.parse(text) as ValhallaResponse
    } catch {
      return NextResponse.json({ error: 'Routing-tjenesten gav et ugyldigt svar' }, { status: 502 })
    }

    if (!upstream.ok || !data.trip) {
      const message = data.error || data.status || 'Køreruten kunne ikke beregnes'
      return NextResponse.json({ error: message }, { status: 502 })
    }

    const returnedLocations = data.trip.locations ?? data.locations ?? []
    const orderedIndexes = returnedLocations.length === stops.length
      ? returnedLocations.map((location, index) => (
          Number.isInteger(location.original_index) ? location.original_index! : index
        ))
      : stops.map((_, index) => index)

    const orderedStopIds = orderedIndexes.map(index => stops[index]?.id).filter(Boolean)
    const shapes = (data.trip.legs ?? []).map(leg => leg.shape).filter((shape): shape is string => Boolean(shape))

    return NextResponse.json({
      optimized: action === 'optimized_route',
      orderedStopIds,
      shapes,
      distanceKm: data.trip.summary?.length ?? null,
      durationSeconds: data.trip.summary?.time ?? null,
    })
  } catch {
    return NextResponse.json({ error: 'Routing-tjenesten kunne ikke kontaktes' }, { status: 502 })
  }
}
