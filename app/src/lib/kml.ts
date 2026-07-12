import type { PinExportRow } from './pins'
import type { PinRoute } from '@/types/pin'
import { PIN_STATUS_LABELS } from '@/types/pin'

const DEFAULT_PIN_ICON = '📍'

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

export interface MarkerStyle {
  id: string
  icon: string
}

function styleId(icon: string): string {
  const iconCode = Array.from(icon).map(c => c.codePointAt(0)!.toString(16)).join('-')
  return `marker-${iconCode}`
}

export interface BuiltKml {
  kml: string
  // Distincte ikoner brugt i eksporten — route.ts bygger ét PNG-ikon pr. stil og lægger dem i icons/<id>.png
  styles: MarkerStyle[]
}

const ROUTE_STYLE_ID = 'ue-route-line'

export function buildKml(pins: PinExportRow[]): BuiltKml {
  const styleMap = new Map<string, MarkerStyle>()
  for (const pin of pins) {
    const icon = pin.icon || DEFAULT_PIN_ICON
    const id = styleId(icon)
    if (!styleMap.has(id)) styleMap.set(id, { id, icon })
  }
  const styles = Array.from(styleMap.values())

  const styleTags = styles.map(
    s => `  <Style id="${s.id}">
    <IconStyle>
      <scale>1.2</scale>
      <Icon><href>icons/${s.id}.png</href></Icon>
    </IconStyle>
  </Style>`
  ).join('\n')

  function buildPointPlacemark(pin: PinExportRow): string {
    const icon = pin.icon || DEFAULT_PIN_ICON
    const stars = '★'.repeat(pin.rating) + '☆'.repeat(3 - pin.rating)
    const imageTags = pin.images
      .map(img => `<img src="images/${escapeXml(img.filename)}" style="max-width:400px" /><br/>`)
      .join('\n')

    const description = `<![CDATA[
      <p><b>Status:</b> ${escapeXml(PIN_STATUS_LABELS[pin.status])}</p>
      <p><b>Vurdering:</b> ${stars}</p>
      ${pin.categoryName ? `<p><b>Kategori:</b> ${escapeXml(pin.categoryName)}</p>` : ''}
      ${pin.description ? `<p><b>Beskrivelse:</b><br/>${escapeXml(pin.description).replace(/\n/g, '<br/>')}</p>` : ''}
      <p><b>Koordinater:</b> ${pin.latitude.toFixed(6)}, ${pin.longitude.toFixed(6)}</p>
      ${imageTags}
    ]]>`

    return `    <Placemark>
      <name>${escapeXml(pin.name)}</name>
      <description>${description}</description>
      <styleUrl>#${styleId(icon)}</styleUrl>
      <Point><coordinates>${pin.longitude},${pin.latitude},0</coordinates></Point>
    </Placemark>`
  }

  function buildRoutePlacemark(route: PinRoute): string {
    return `    <Placemark>
      <name>${escapeXml(route.name || 'Rute')}</name>
      <styleUrl>#${ROUTE_STYLE_ID}</styleUrl>
      <LineString>
        <tessellate>1</tessellate>
        <coordinates>${route.points.map(p => `${p.lng},${p.lat},0`).join(' ')}</coordinates>
      </LineString>
    </Placemark>`
  }

  // Pins uden ruter forbliver flade Placemarks. Pins med ruter pakkes ind i en
  // Folder sammen med deres rute(r), så pin og rute vises som én gruppe med
  // fælles afkrydsning i Google Earths "Steder"-panel, i stedet for løsrevne søskende.
  const entries = pins.map(pin => {
    const validRoutes = pin.routes.filter(route => route.points.length >= 2)
    const pointPlacemark = buildPointPlacemark(pin)
    if (validRoutes.length === 0) return pointPlacemark

    const routePlacemarks = validRoutes.map(buildRoutePlacemark).join('\n')
    return `  <Folder>
    <name>${escapeXml(pin.name)}</name>
${pointPlacemark}
${routePlacemarks}
  </Folder>`
  }).join('\n')

  const hasRoutes = pins.some(pin => pin.routes.some(route => route.points.length >= 2))
  const routeStyleTag = hasRoutes
    ? `  <Style id="${ROUTE_STYLE_ID}">
    <LineStyle><color>ff3c8ae0</color><width>4</width></LineStyle>
  </Style>`
    : ''

  const kml = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
<Document>
  <name>Urban Explorer eksport</name>
${styleTags}
${routeStyleTag}
${entries}
</Document>
</kml>`

  return { kml, styles }
}
