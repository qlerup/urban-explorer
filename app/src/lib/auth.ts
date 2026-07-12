import argon2 from 'argon2'
import { SignJWT } from 'jose'
import { cookies } from 'next/headers'
import { COOKIE_NAME, SessionPayload, verifyToken } from './auth-edge'

export { COOKIE_NAME, verifyToken }
export type { SessionPayload }

const ARGON2_OPTIONS = {
  type: argon2.argon2id,
  memoryCost: 65536,
  timeCost: 3,
  parallelism: 4,
  saltLength: 32,
  hashLength: 32,
}

const DUMMY_HASH = '$argon2id$v=19$m=65536,t=3,p=4$c29tZXJhbmRvbXNhbHRmb3J0aW1pbmc$RGVubmVoYXNoZXJrdW5icnVndGlsaW5nZW50aW5n'

export async function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, ARGON2_OPTIONS)
}

export async function verifyPassword(hash: string, password: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, password)
  } catch {
    return false
  }
}

export async function runDummyVerify(): Promise<void> {
  await argon2.verify(DUMMY_HASH, 'dummy_timing_protection').catch(() => {})
}

const ALGORITHM = 'HS512'
const EXPIRY = '12h'

function getJwtSecret(): Uint8Array {
  const secret = process.env.JWT_SECRET
  if (!secret) throw new Error('JWT_SECRET mangler i miljøvariable')
  return new TextEncoder().encode(secret)
}

export async function createToken(payload: SessionPayload): Promise<string> {
  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: ALGORITHM })
    .setIssuedAt()
    .setExpirationTime(EXPIRY)
    .sign(getJwtSecret())
}

export async function getSession(): Promise<SessionPayload | null> {
  const cookieStore = await cookies()
  const token = cookieStore.get(COOKIE_NAME)?.value
  if (!token) return null
  return verifyToken(token)
}
