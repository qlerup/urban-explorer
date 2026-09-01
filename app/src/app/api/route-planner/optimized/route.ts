import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'

export const dynamic = 'force-dynamic'

const DEFAULT_VALHALLA_URL = 'https://valhalla1.openstreetmap.de'
const MAX_STOPS = 50
const VALHALLA_TIMEOUT_MS = 60_000
const SNAP_RADIUS_METERS = 5000
const MINIMUM_REACHABILITY = 1

type ValhallaAction = 'route' | 'optimized_route' | 'locate'

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
  summary?: {
    length?: number
    time?: number
  }
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

interface LocateEdge {
  distance?: number
}

interface LocateResult {
  edges?: LocateEdge[]
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

function valhallaLocation(stop: InputStop) {
  return {
    lat: stop.lat,
    lon: stop.lng,
    type: 'break',
    radius: SNAP_RADIUS_METERS,
    minimum_reachability: MINIMUM_REACHABILITY,
    rank_candidates: true,
  }
}

async function requestValhalla(action: ValhallaAction, payload: object): Promise<Response> {
  const baseUrl = (process.env.VALHALLA_URL || DEFAULT_VALHALLA_URL).replace(/\/$/, '')
  const endpoint = `${baseUrl}/${action}`

  let response = await fetch(endpoint, {
    method: 'POST',
    cache: 'no-store',
    signal: AbortSignal.timeout(VALHALLA_TIMEOUT_MS),
    headers: {
      'Content-Type': 'application/json',
      'X-Client-Id': 'urban-explorer',
    },
    body: JSON.stringify(payload),
  })

  if (response.status === 404 || response.status === 405) {
    const url = new URL(endpoint)
    url.searchParams.set('json', JSON.stringify(payload))
    response = await fetch(url, {
      cache: 'no-store',
      signal: AbortSignal.timeout(VALHALLA_TIMEOUT_MS),
      headers: { 'X-Client-Id': 'urban-explorer' },
    })
  }

  return response
}

async function findUnsnappableStopIndex(stops: InputStop[]): Promise<number | null> {
  for (let index = 0; index < stops.length; index += 1) {
    const response = await requestValhalla('locate', {
      locations: [valhallaLocation(stops[index])],
      costing: 'auto',
      verbose: false,
    })

    if (!response.ok) return index

    let data: unknown
    try {
      data = JSON.parse(await response.text())
    } catch {
      return index
    }

    const result = Array.isArray(data) ? data[0] as LocateResult | undefined : undefined
    if (!result || !Array.isArray(result.edges) || result.edges.length === 0) return index
  }

  return null
}

export async function POST(request: NextRequest) {
  if (!(await getSession())) return NextResponse.json({ error: 'Ikke logget ind' }, { status: 401 })

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
    locations: stops.map(valhallaLocation),
    costing: 'auto',
    directions_options: { units: 'kilometers' },
  }

  const action: ValhallaAction = stops.length >= 4 ? 'optimized_route' : 'route'

  try {
    const upstream = await requestValhalla(action, payload)
    const text = await upstream.text()
    let data: ValhallaResponse

    try {
      data = JSON.parse(text) as ValhallaResponse
    } catch {
      return NextResponse.json({ error: 'Rute-serveren gav et ugyldigt svar.' }, { status: 503 })
    }

    if (!upstream.ok || !data.trip) {
      if (data.error_code === 171 || data.error?.includes('No suitable edges near location')) {
        const failedIndex = await findUnsnappableStopIndex(stops)
        if (failedIndex !== null) {
          return NextResponse.json(
            {
              error: `Pin nr. ${failedIndex + 1} kunne ikke forbindes til en kørbar vej inden for 5 km.`,
              failedStopId: stops[failedIndex].id,
              failedStopIndex: failedIndex,
            },
            { status: 422 }
          )
        }

        return NextResponse.json(
          { error: 'Valhalla kunne finde veje ved alle pins, men kunne ikke forbinde dem til en samlet bilrute.' },
          { status: 422 }
        )
      }

      if (data.error?.includes('No data found for location')) {
        return NextResponse.json(
          { error: 'Et af de valgte pins ligger uden for de routing-kortdata, der er installeret.' },
          { status: 422 }
        )
      }

      const message = data.error || data.status || 'Køreruten kunne ikke beregnes'
      return NextResponse.json({ error: message }, { status: upstream.status >= 500 ? 503 : 502 })
    }

    const returnedLocations = data.trip.locations ?? data.locations ?? []
    const orderedIndexes = returnedLocations.length === stops.length
      ? returnedLocations.map((location, index) => (
          Number.isInteger(location.original_index) ? location.original_index! : index
        ))
      : stops.map((_, index) => index)

    const orderedStopIds = orderedIndexes.map(index => stops[index]?.id).filter(Boolean)
    const tripLegs = data.trip.legs ?? []
    const shapes = tripLegs.map(leg => leg.shape).filter((shape): shape is string => Boolean(shape))
    const legs = tripLegs.map((leg, index) => ({
      fromId: orderedStopIds[index] ?? null,
      toId: orderedStopIds[index + 1] ?? null,
      distanceKm: leg.summary?.length ?? null,
      durationSeconds: leg.summary?.time ?? null,
    }))

    return NextResponse.json({
      optimized: action === 'optimized_route',
      orderedStopIds,
      shapes,
      legs,
      distanceKm: data.trip.summary?.length ?? null,
      durationSeconds: data.trip.summary?.time ?? null,
    })
  } catch (error) {
    const name = error instanceof Error ? error.name : ''
    if (name === 'TimeoutError' || name === 'AbortError') {
      return NextResponse.json(
        { error: 'Ruteoptimeringen tog længere end 60 sekunder. Prøv igen med færre pins.' },
        { status: 504 }
      )
    }

    return NextResponse.json(
      { error: 'Rute-serveren kunne ikke kontaktes. Tjek at Valhalla-containeren kører.' },
      { status: 503 }
    )
  }
}
