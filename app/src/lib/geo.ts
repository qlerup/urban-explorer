import type { RoutePoint } from '@/types/pin'

export function haversineMeters(a: RoutePoint, b: RoutePoint): number {
  const R = 6371000
  const toRad = (d: number) => (d * Math.PI) / 180
  const dLat = toRad(b.lat - a.lat)
  const dLng = toRad(b.lng - a.lng)
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(s))
}

export function routeDistanceMeters(points: RoutePoint[]): number {
  let total = 0
  for (let i = 0; i < points.length - 1; i++) {
    total += haversineMeters(points[i], points[i + 1])
  }
  return total
}

export function formatDistance(meters: number): string {
  if (meters < 1000) return `${Math.round(meters)} m`
  return `${(meters / 1000).toFixed(2)} km`
}

/** Konverter WGS84-koordinater til ETRS89 / UTM zone 32N (EPSG:25832). */
export function wgs84ToUtm32(lat: number, lng: number): { easting: number; northing: number } {
  const semiMajorAxis = 6378137
  const eccentricitySquared = 0.00669438
  const scaleFactor = 0.9996
  const radians = Math.PI / 180
  const latitude = lat * radians
  const longitudeDelta = (lng - 9) * radians
  const eccentricityPrimeSquared = eccentricitySquared / (1 - eccentricitySquared)
  const sinLatitude = Math.sin(latitude)
  const cosLatitude = Math.cos(latitude)
  const tanLatitude = Math.tan(latitude)
  const radius = semiMajorAxis / Math.sqrt(1 - eccentricitySquared * sinLatitude ** 2)
  const tangentSquared = tanLatitude ** 2
  const curvature = eccentricityPrimeSquared * cosLatitude ** 2
  const longitudeTerm = cosLatitude * longitudeDelta
  const meridionalArc = semiMajorAxis * (
    (1 - eccentricitySquared / 4 - 3 * eccentricitySquared ** 2 / 64 - 5 * eccentricitySquared ** 3 / 256) * latitude
    - (3 * eccentricitySquared / 8 + 3 * eccentricitySquared ** 2 / 32 + 45 * eccentricitySquared ** 3 / 1024) * Math.sin(2 * latitude)
    + (15 * eccentricitySquared ** 2 / 256 + 45 * eccentricitySquared ** 3 / 1024) * Math.sin(4 * latitude)
    - (35 * eccentricitySquared ** 3 / 3072) * Math.sin(6 * latitude)
  )

  const easting = scaleFactor * radius * (
    longitudeTerm
    + (1 - tangentSquared + curvature) * longitudeTerm ** 3 / 6
    + (5 - 18 * tangentSquared + tangentSquared ** 2 + 72 * curvature - 58 * eccentricityPrimeSquared) * longitudeTerm ** 5 / 120
  ) + 500000
  const northing = scaleFactor * (
    meridionalArc
    + radius * tanLatitude * (
      longitudeTerm ** 2 / 2
      + (5 - tangentSquared + 9 * curvature + 4 * curvature ** 2) * longitudeTerm ** 4 / 24
      + (61 - 58 * tangentSquared + tangentSquared ** 2 + 600 * curvature - 330 * eccentricityPrimeSquared) * longitudeTerm ** 6 / 720
    )
  )

  return { easting, northing }
}
