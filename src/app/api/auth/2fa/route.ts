import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireActiveUser, isPlatformAdminEmail } from '@/lib/auth-server'
import { rateLimit, isHttpsRequest } from '@/lib/api-security'
import { auditLog } from '@/lib/audit'
import { formatTotpSecret, generateTotpSecret, getTotpUri, verifyTotpCode } from '@/lib/totp'
import { decryptSecret, encryptSecret, resolveAndMigrateSecret } from '@/lib/secret-crypto'
import { signToken } from '@/lib/jwt'

function setFullSessionCookie(
  req: NextRequest,
  res: NextResponse,
  user: {
    id: string
    email: string
    name: string
    role: 'OFFICE_MANAGER' | 'LAWYER' | 'CITIZEN'
    officeId: string
    clientId: string | null
    sessionVersion: number
  }
) {
  const token = signToken({
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    officeId: user.officeId,
    clientId: user.clientId ?? null,
    sessionVersion: user.sessionVersion,
    twoFactorVerified: true,
  })

  res.cookies.set('ds_token', token, {
    httpOnly: true,
    secure: isHttpsRequest(req),
    sameSite: 'lax',
    maxAge: 60 * 60 * 24 * 7,
    path: '/',
  })
}

function publicUser(user: {
  id: string
  email: string
  name: string
  role: 'OFFICE_MANAGER' | 'LAWYER' | 'CITIZEN'
  officeId: string
  barNumber: string | null
  clientId: string | null
  twoFactorEnabled: boolean
  office: { name: string } | null
}) {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    officeId: user.officeId,
    officeName: user.office?.name ?? null,
    isPlatformAdmin: user.role === 'OFFICE_MANAGER' && isPlatformAdminEmail(user.email),
    barNumber: user.barNumber,
    clientId: user.clientId ?? null,
    twoFactorEnabled: user.twoFactorEnabled,
  }
}

export async function GET(req: NextRequest) {
  const auth = await requireActiveUser(req)
  if (!auth.ok) return auth.response

  const user = await prisma.user.findUnique({
    where: { id: auth.user.id },
    select: { twoFactorEnabled: true, twoFactorSecret: true },
  })

  return NextResponse.json({
    enabled: Boolean(user?.twoFactorEnabled),
    setupPending: Boolean(user?.twoFactorSecret && !user.twoFactorEnabled),
  })
}

export async function POST(req: NextRequest) {
  const auth = await requireActiveUser(req)
  if (!auth.ok) return auth.response
  const limited = rateLimit(req, `2fa:setup:${auth.user.id}`, { limit: 10, windowMs: 60 * 60_000 })
  if (limited) return limited

  const existing = await prisma.user.findUnique({
    where: { id: auth.user.id },
    select: { twoFactorEnabled: true },
  })
  if (existing?.twoFactorEnabled) {
    return NextResponse.json({ error: 'المصادقة الثنائية مفعلة مسبقاً' }, { status: 400 })
  }

  const secret = generateTotpSecret()
  await prisma.user.update({
    where: { id: auth.user.id },
    data: { twoFactorSecret: encryptSecret(secret), twoFactorEnabled: false },
  })

  await auditLog(req, auth.user, 'auth.2fa_setup_started')
  return NextResponse.json({
    otpauthUrl: getTotpUri(auth.user.email, secret),
    manualKey: formatTotpSecret(secret),
  })
}

export async function PATCH(req: NextRequest) {
  const auth = await requireActiveUser(req)
  if (!auth.ok) return auth.response
  const limited = rateLimit(req, `2fa:enable:${auth.user.id}`, { limit: 10, windowMs: 60 * 60_000 })
  if (limited) return limited

  const body = await req.json().catch(() => null)
  const code = body?.code
  const user = await prisma.user.findUnique({
    where: { id: auth.user.id },
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      officeId: true,
      clientId: true,
      barNumber: true,
      sessionVersion: true,
      twoFactorEnabled: true,
      twoFactorSecret: true,
      office: { select: { name: true } },
    },
  })

  if (!user?.twoFactorSecret) {
    return NextResponse.json({ error: 'ابدأ إعداد المصادقة الثنائية أولاً' }, { status: 400 })
  }
  const secret = await resolveAndMigrateSecret(user.twoFactorSecret, (encrypted) =>
    prisma.user.update({ where: { id: user.id }, data: { twoFactorSecret: encrypted } })
  )
  if (!verifyTotpCode(secret, code)) {
    await auditLog(req, auth.user, 'auth.2fa_enable_failed', { metadata: { reason: 'invalid_code' } })
    return NextResponse.json({ error: 'رمز التحقق غير صحيح' }, { status: 400 })
  }

  const updated = await prisma.user.update({
    where: { id: user.id },
    data: { twoFactorEnabled: true, sessionVersion: { increment: 1 } },
    include: { office: { select: { name: true } } },
  })

  const res = NextResponse.json({ ok: true, user: publicUser(updated) })
  setFullSessionCookie(req, res, updated)
  await auditLog(req, { id: updated.id, email: updated.email, role: updated.role, officeId: updated.officeId }, 'auth.2fa_enabled')
  return res
}

export async function DELETE(req: NextRequest) {
  const auth = await requireActiveUser(req)
  if (!auth.ok) return auth.response
  const limited = rateLimit(req, `2fa:disable:${auth.user.id}`, { limit: 10, windowMs: 60 * 60_000 })
  if (limited) return limited

  const body = await req.json().catch(() => null)
  const code = body?.code
  const user = await prisma.user.findUnique({
    where: { id: auth.user.id },
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      officeId: true,
      clientId: true,
      barNumber: true,
      sessionVersion: true,
      twoFactorEnabled: true,
      twoFactorSecret: true,
      office: { select: { name: true } },
    },
  })

  if (!user) return NextResponse.json({ error: 'جلسة منتهية' }, { status: 401 })
  if (!user.twoFactorEnabled || !user.twoFactorSecret) {
    return NextResponse.json({ error: 'المصادقة الثنائية غير مفعلة' }, { status: 400 })
  }
  // Row is about to be wiped below regardless, so no need to migrate-on-read here.
  if (!verifyTotpCode(decryptSecret(user.twoFactorSecret), code)) {
    await auditLog(req, auth.user, 'auth.2fa_disable_failed', { metadata: { reason: 'invalid_code' } })
    return NextResponse.json({ error: 'رمز التحقق غير صحيح' }, { status: 400 })
  }

  const updated = await prisma.user.update({
    where: { id: user.id },
    data: { twoFactorEnabled: false, twoFactorSecret: null, sessionVersion: { increment: 1 } },
    include: { office: { select: { name: true } } },
  })

  const res = NextResponse.json({ ok: true, user: publicUser(updated) })
  setFullSessionCookie(req, res, updated)
  await auditLog(req, { id: updated.id, email: updated.email, role: updated.role, officeId: updated.officeId }, 'auth.2fa_disabled')
  return res
}
