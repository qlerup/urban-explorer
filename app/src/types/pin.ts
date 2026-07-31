export interface PinImage {
  id: string
  url: string
  originalName: string
  mimeType: string
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
  ownerId?: string
  /** Om du må tilføje/redigere pins - kun relevant når sharedBy er sat */
  canEdit?: boolean
}

export interface SharedWorkspace {
  ownerId: string
  ownerName: string
  canEdit: boolean
  uncategorized: boolean
  canEditUncategorized: boolean
}

export const CUSTOM_PIN_ICONS = [
  { value: '/pin-icons/pin.svg', label: 'Pin' },
  { value: '/pin-icons/doedt-spot.svg', label: 'Dødt spot' },
  { value: '/pin-icons/hus.svg', label: 'Hus' },
  { value: '/pin-icons/gaard.svg', label: 'Gård' },
  { value: '/pin-icons/slot.svg', label: 'Slot' },
  { value: '/pin-icons/kirke.svg', label: 'Kirke' },
  { value: '/pin-icons/kirkegaard.svg', label: 'Kirkegård' },
  { value: '/pin-icons/mansion.svg', label: 'Mansion' },
  { value: '/pin-icons/industri.svg', label: 'Industri' },
  { value: '/pin-icons/hold-oeje.svg', label: 'Hold øje' },
  { value: '/pin-icons/overnatning.svg', label: 'Overnatning' },
] as const

// Ældre pins kan stadig have et af disse emoji-ikoner gemt fra før vi lavede vores
// egne. De er ikke længere valgbare i ikon-vælgeren, men skal fortsat accepteres
// som gyldig værdi, så gamle pins ikke fejler ved redigering.
const LEGACY_EMOJI_PIN_ICONS = ['📍', '🏭', '🏚️', '🏥', '🏫', '🚉', '🏰', '⛪', '🌉', '🕳️', '🏢', '🚢', '🎪', '🏊', '🛖', '⚙️'] as const

export const PIN_ICON_OPTIONS: readonly string[] = CUSTOM_PIN_ICONS.map(icon => icon.value)

export const VALID_PIN_ICONS: readonly string[] = [
  ...LEGACY_EMOJI_PIN_ICONS,
  ...PIN_ICON_OPTIONS,
]

export function getCustomPinIcon(icon: string) {
  return CUSTOM_PIN_ICONS.find(option => option.value === icon)
}

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
  categories: Category[]
  /** Første kategori, bevaret for visninger der bruger én primær farve. */
  category: Category | null
  createdAt: string
  images: PinImage[]
  routes: PinRoute[]
  /** false når pinnen er delt med dig uden redigeringsret. Udeladt = redigerbar */
  canEdit?: boolean
  /** Ejerens fornavn - kun sat på pins der ikke er dine egne */
  ownerName?: string
  /** Ejerens id - bruges til at holde delte ukategoriserede pins adskilt pr. ejer */
  ownerId?: string
}
