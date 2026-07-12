import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes } from 'crypto'

const ALGORITHM = 'aes-256-gcm'
const KEY_BYTES = 32
const IV_BYTES = 12
const TAG_BYTES = 16

let cachedKey: Buffer | null = null
let cachedRaw: string | null = null

function getKey(): Buffer {
  const raw = process.env.ENCRYPTION_KEY
  if (!raw) throw new Error('ENCRYPTION_KEY mangler i miljøvariable')
  if (cachedKey && cachedRaw === raw) return cachedKey
  // Nøjagtigt 32 bytes base64 bruges direkte (eksisterende installationer).
  // Alle andre formater (fx FjordHubs auto-genererede secrets) afledes
  // deterministisk til 32 bytes via SHA-256.
  const decoded = Buffer.from(raw, 'base64')
  cachedKey = decoded.length === KEY_BYTES ? decoded : createHash('sha256').update(raw, 'utf8').digest()
  cachedRaw = raw
  return cachedKey
}

export function encrypt(plaintext: string): string {
  const key = getKey()
  const iv = randomBytes(IV_BYTES)
  const cipher = createCipheriv(ALGORITHM, key, iv, { authTagLength: TAG_BYTES })
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return `${iv.toString('base64')}:${tag.toString('base64')}:${encrypted.toString('base64')}`
}

export function decrypt(ciphertext: string): string {
  const key = getKey()
  const parts = ciphertext.split(':')
  if (parts.length !== 3) throw new Error('Ugyldigt krypteringsformat')
  const [ivB64, tagB64, dataB64] = parts
  const iv = Buffer.from(ivB64, 'base64')
  const tag = Buffer.from(tagB64, 'base64')
  const data = Buffer.from(dataB64, 'base64')
  const decipher = createDecipheriv(ALGORITHM, key, iv, { authTagLength: TAG_BYTES })
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8')
}

export function decryptIfEncrypted(value: unknown): string {
  if (value == null) return ''
  const text = String(value)
  try {
    return decrypt(text)
  } catch {
    return text
  }
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase()
}

export function hashEmail(email: string): string {
  return createHmac('sha256', getKey()).update(normalizeEmail(email)).digest('base64url')
}
