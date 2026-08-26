import { NextRequest, NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import { prisma } from '@/lib/prisma'
import { requireOfficeManager } from '@/lib/auth-server'
import { rateLimit } from '@/lib/api-security'
import { auditLog } from '@/lib/audit'

function isValidEmail(value: unknown) {
  return typeof value === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim())
}

export async function POST(req: NextRequest) {
  try {
    const auth = await requireOfficeManager(req)
    if (!auth.ok) return auth.response
    const limited = rateLimit(req, `citizen:create:${auth.user.id}`, { limit: 20, windowMs: 60 * 60_000 })
    if (limited) return limited

    const payload = await req.json().catch(() => null)
    const { clientId, email, password } = payload ?? {}
    if (typeof clientId !== 'string' || !clientId || !isValidEmail(email) || typeof password !== 'string') {
      return NextResponse.json({ error: 'البيانات ناقصة' }, { status: 400 })
    }
    if (password.length < 8) {
      return NextResponse.json({ error: 'كلمة المرور يجب أن تكون 8 أحرف على الأقل' }, { status: 400 })
    }

    // Verify client belongs to this office
    const client = await prisma.client.findFirst({
      where: { id: clientId, officeId: auth.user.officeId },
      include: { citizenUser: true },
    })
    if (!client) return NextResponse.json({ error: 'الموكل غير موجود' }, { status: 404 })
    if (client.citizenUser) return NextResponse.json({ error: 'حساب المواطن موجود مسبقاً' }, { status: 409 })

    const existing = await prisma.user.findUnique({ where: { email: email.toLowerCase().trim() } })
    if (existing) return NextResponse.json({ error: 'البريد الإلكتروني مستخدم مسبقاً' }, { status: 409 })

    const hashed = await bcrypt.hash(password, 10)
    const citizenUser = await prisma.user.create({
      data: {
        email: email.toLowerCase().trim(),
        password: hashed,
        name: client.name,
        role: 'CITIZEN',
        officeId: auth.user.officeId,
        clientId: client.id,
      },
    })

    await auditLog(req, auth.user, 'citizen.account_created', {
      entityType: 'user',
      entityId: citizenUser.id,
      metadata: { clientId: client.id },
    })
    return NextResponse.json({ id: citizenUser.id, email: citizenUser.email, name: citizenUser.name })
  } catch (err) {
    console.error(err)
    return NextResponse.json({ error: 'خطأ في الخادم' }, { status: 500 })
  }
}
