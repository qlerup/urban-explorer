import { jwtVerify } from 'jose'

export const COOKIE_NAME = 'ue_session'
const ALGORITHM = 'HS512'

export interface SessionPayload {
  userId: string
  isAdmin: boolean
  mustChangePassword: boolean
}

function getJwtSecret(): Uint8Array {
  const secret = process.env.JWT_SECRET
  if (!secret) throw new Error('JWT_SECRET mangler i miljøvariable')
  return new TextEncoder().encode(secret)
}

export async function verifyToken(token: string): Promise<SessionPayload | null> {
  try {
    const { payload } = await jwtVerify(token, getJwtSecret(), {
      algorithms: [ALGORITHM],
    })
    return payload as unknown as SessionPayload
  } catch {
    return null
  }
}
