import jwt from 'jsonwebtoken'
import type { SignOptions } from 'jsonwebtoken'
import { JWT_SECRET } from '@/lib/env'

const JWT_ISSUER = 'dostoori'
const JWT_AUDIENCE = 'dostoori-app'

export interface JWTPayload {
  id: string
  email: string
  name: string
  role: 'OFFICE_MANAGER' | 'LAWYER' | 'CITIZEN'
  officeId: string | null
  clientId?: string | null
  sessionVersion?: number
  twoFactorVerified?: boolean
}

export function signToken(payload: JWTPayload, options: { expiresIn?: SignOptions['expiresIn'] } = {}): string {
  return jwt.sign(payload, JWT_SECRET, {
    expiresIn: options.expiresIn ?? '7d',
    issuer: JWT_ISSUER,
    audience: JWT_AUDIENCE,
    algorithm: 'HS256',
  })
}

export function verifyToken(token: string): JWTPayload | null {
  try {
    return jwt.verify(token, JWT_SECRET, {
      issuer: JWT_ISSUER,
      audience: JWT_AUDIENCE,
      algorithms: ['HS256'],
    }) as JWTPayload
  } catch {
    return null
  }
}
