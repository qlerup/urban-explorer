export interface PinImage {
  id: string
  url: string
  originalName: string
}

export interface RoutePoint {
  lat: number
  lng: number
}

export interface PinRoute {
  id: string
  name: string
  points: RoutePoint[]
  distanceMeters: number
}

export interface Category {
  id: string
  name: string
  color: string
  /** Antal brugere kategorien er delt med (kun sat på egne kategorier) */
  shareCount?: number
  /** Ejerens fornavn - kun sat på kategorier der er delt med dig */
  sharedBy?: string
  /** Om du må tilføje/redigere pins - kun relevant når sharedBy er sat */
  canEdit?: boolean
}

export const PIN_ICON_OPTIONS = ['📍', '🏭', '🏚️', '🏥', '🏫', '🚉', '🏰', '⛪', '🌉', '🕳️', '🏢', '🚢', '🎪', '🏊', '🛖', '⚙️']

export const PIN_STATUSES = ['vil_se', 'har_set', 'hold_oeje', 'doedt_spot'] as const
export type PinStatus = (typeof PIN_STATUSES)[number]

export const PIN_STATUS_LABELS: Record<PinStatus, string> = {
  vil_se: 'Vil se',
  har_set: 'Har set',
  hold_oeje: 'Hold øje',
  doedt_spot: 'Dødt spot',
}

export const PIN_STATUS_COLORS: Record<PinStatus, string> = {
  vil_se: '#3b82f6',
  har_set: '#22c55e',
  hold_oeje: '#e08a3c',
  doedt_spot: '#6b7280',
}

export function isPinStatus(value: unknown): value is PinStatus {
  return typeof value === 'string' && (PIN_STATUSES as readonly string[]).includes(value)
}

export interface Pin {
  id: string
  name: string
  description: string
  latitude: number
  longitude: number
  rating: number
  status: PinStatus
  icon: string
  category: Category | null
  createdAt: string
  images: PinImage[]
  routes: PinRoute[]
  /** false når pinnen er delt med dig uden redigeringsret. Udeladt = redigerbar */
  canEdit?: boolean
  /** Ejerens fornavn - kun sat på pins der ikke er dine egne */
  ownerName?: string
}
