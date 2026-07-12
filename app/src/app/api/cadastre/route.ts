import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

const CADASTRAL_WMS_URL = 'https://api.dataforsyningen.dk/wms/cp_inspire'
const CADASTRAL_PARCEL_LAYER = 'CP.CadastralParcel'
const CADASTRAL_ZONING_LAYER = 'CP.CadastralZoning'

interface CadastralParcelInfo {
  ogcFid?: string
  label?: string
  nationalCadastralReference?: string
  areaValue?: number
  inspireId?: string
  validFrom?: string
  basicPropertyUnitId?: string
  administrativeUnitCode?: string
  cadastralZoningReference?: string
  cadastralParcelId?: string
}

interface CadastralZoningInfo {
  label?: string
  reference?: string
  levelName?: string
  validFrom?: string
  originalMapScaleDenominator?: number
}

function parseIntegerParam(value: string | null, min: number, max: number): number | null {
  if (!value) return null
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) return null
  return parsed
}

function parseBbox(value: string | null): [number, number, number, number] | null {
  if (!value) return null
  const parts = value.split(',').map(part => Number(part))
  if (parts.length !== 4 || parts.some(part => !Number.isFinite(part))) return null

  const [minX, minY, maxX, maxY] = parts
  if (minX >= maxX || minY >= maxY) return null

  return [minX, minY, maxX, maxY]
}

function parseFeatureInfoValues(text: string): Map<string, string> {
  const values = new Map<string, string>()

  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^\s*([a-zA-Z0-9_]+)\s*=\s*'(.*)'\s*$/)
    if (match) values.set(match[1].toLowerCase(), match[2])
  }

  return values
}

function lastUrlPart(value: string | undefined): string | undefined {
  if (!value) return undefined
  const lastPart = value.split('/').filter(Boolean).at(-1)
  return lastPart || undefined
}

function parseCadastralParcelInfo(text: string): CadastralParcelInfo | null {
  const values = parseFeatureInfoValues(text)
  if (values.size === 0) return null

  const areaValue = Number(values.get('areavalue'))
  return {
    ogcFid: values.get('ogc_fid') || undefined,
    label: values.get('label') || undefined,
    nationalCadastralReference: values.get('nationalcadastralreference') || undefined,
    areaValue: Number.isFinite(areaValue) ? areaValue : undefined,
    inspireId: values.get('inspireid') || undefined,
    validFrom: values.get('validfrom') || values.get('beginlifespanversion') || undefined,
    basicPropertyUnitId: lastUrlPart(values.get('basicpropertyunit')),
    administrativeUnitCode: lastUrlPart(values.get('administrativeunit')),
    cadastralZoningReference: lastUrlPart(values.get('zoning')),
    cadastralParcelId: lastUrlPart(values.get('inspireid')),
  }
}

function parseCadastralZoningInfo(text: string): CadastralZoningInfo | null {
  const values = parseFeatureInfoValues(text)
  if (values.size === 0) return null

  const originalMapScaleDenominator = Number(values.get('originalmapscaledenominator'))
  return {
    label: values.get('label') || undefined,
    reference: values.get('nationalcadastalzoningreference') || undefined,
    levelName: values.get('levelname') || undefined,
    validFrom: values.get('validfrom') || values.get('beginlifespanversion') || undefined,
    originalMapScaleDenominator: Number.isFinite(originalMapScaleDenominator) ? originalMapScaleDenominator : undefined,
  }
}

function buildFeatureInfoUrl(layer: string, bbox: [number, number, number, number], width: number, height: number, x: number, y: number): URL {
  const upstream = new URL(CADASTRAL_WMS_URL)
  upstream.search = new URLSearchParams({
    SERVICE: 'WMS',
    VERSION: '1.1.1',
    REQUEST: 'GetFeatureInfo',
    FORMAT: 'image/png',
    TRANSPARENT: 'TRUE',
    LAYERS: layer,
    QUERY_LAYERS: layer,
    STYLES: '',
    WIDTH: String(width),
    HEIGHT: String(height),
    SRS: 'EPSG:3857',
    BBOX: bbox.join(','),
    X: String(x),
    Y: String(y),
    INFO_FORMAT: 'text/plain',
    FEATURE_COUNT: '3',
  }).toString()
  return upstream
}

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams
  const bbox = parseBbox(params.get('bbox'))
  const width = parseIntegerParam(params.get('width'), 1, 10000)
  const height = parseIntegerParam(params.get('height'), 1, 10000)
  const x = parseIntegerParam(params.get('x'), 0, width ?? 0)
  const y = parseIntegerParam(params.get('y'), 0, height ?? 0)

  if (!bbox || !width || !height || x === null || y === null) {
    return NextResponse.json({ error: 'Ugyldige kortparametre' }, { status: 400 })
  }

  const [parcelResponse, zoningResponse] = await Promise.all([
    fetch(buildFeatureInfoUrl(CADASTRAL_PARCEL_LAYER, bbox, width, height, x, y), { cache: 'no-store' }),
    fetch(buildFeatureInfoUrl(CADASTRAL_ZONING_LAYER, bbox, width, height, x, y), { cache: 'no-store' }),
  ])
  if (!parcelResponse.ok) {
    return NextResponse.json({ error: 'Dataforsyningen svarede ikke' }, { status: 502 })
  }

  const parcelText = await parcelResponse.text()
  const zoningText = zoningResponse.ok ? await zoningResponse.text() : ''
  return NextResponse.json({
    parcel: parseCadastralParcelInfo(parcelText),
    zoning: parseCadastralZoningInfo(zoningText),
  })
}
