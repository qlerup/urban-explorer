import { readFileSync } from 'fs'
import path from 'path'
import { Resvg } from '@resvg/resvg-js'

// Codepoint-filnavne for de faste pin-emoji i PIN_ICON_OPTIONS (types/pin.ts).
// SVG'erne er fra Twemoji (CC-BY 4.0, se public/emoji-assets/LICENSE.md) og ligger i public/emoji-assets/.
const EMOJI_CODEPOINTS: Record<string, string> = {
  '📍': '1f4cd',
  '🏭': '1f3ed',
  '🏚️': '1f3da',
  '🏥': '1f3e5',
  '🏫': '1f3eb',
  '🚉': '1f689',
  '🏰': '1f3f0',
  '⛪': '26ea',
  '🌉': '1f309',
  '🕳️': '1f573',
  '🏢': '1f3e2',
  '🚢': '1f6a2',
  '🎪': '1f3aa',
  '🏊': '1f3ca',
  '🛖': '1f6d6',
  '⚙️': '2699',
}

function loadEmojiInner(emoji: string): string | null {
  const codepoint = EMOJI_CODEPOINTS[emoji]
  if (!codepoint) return null
  try {
    const svg = readFileSync(path.join(process.cwd(), 'public', 'emoji-assets', `${codepoint}.svg`), 'utf8')
    const match = svg.match(/<svg[^>]*>([\s\S]*)<\/svg>/)
    return match ? match[1] : null
  } catch {
    return null
  }
}

// Bygger et rundt KML-markørikon: hvid baggrund med sort kant og evt. kategori-emoji ovenpå,
// renderet som ren vektorgrafik via resvg — ingen skrifttype eller font-rendering nødvendig.
export function createMarkerIconPng(emoji: string | null, size = 88): Buffer {
  const glyphInner = emoji ? loadEmojiInner(emoji) : null
  const glyphSize = size * 0.58
  const glyphOffset = (size - glyphSize) / 2

  const glyphMarkup = glyphInner
    ? `<svg x="${glyphOffset}" y="${glyphOffset}" width="${glyphSize}" height="${glyphSize}" viewBox="0 0 36 36">${glyphInner}</svg>`
    : ''

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
    <circle cx="${size / 2}" cy="${size / 2}" r="${size / 2 - 3}" fill="white" stroke="black" stroke-width="4"/>
    ${glyphMarkup}
  </svg>`

  const resvg = new Resvg(svg, { fitTo: { mode: 'width', value: size } })
  return resvg.render().asPng()
}
