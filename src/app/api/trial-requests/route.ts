import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requirePlatformAdmin } from '@/lib/auth-server'
import { enforceRequestSecurity } from '@/lib/api-security'
import { withErrorHandling } from '@/lib/api-handler'

const REQUIRED_FIELDS = [
  'officeName',
  'officeLicense',
  'city',
  'officePhone',
  'lawyerName',
  'lawyerBarNumber',
  'email',
  'mobile',
  'nationalId',
] as const

function text(value: unknown, max = 240) {
  return typeof value === 'string' ? value.trim().slice(0, max) : ''
}

function nullableText(value: unknown) {
  const cleaned = text(value)
  return cleaned || null
}

function isValidEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
}

export const POST = withErrorHandling(async (req: NextRequest) => {
  const blocked = enforceRequestSecurity(req, 'trial-request:create', { limit: 5, windowMs: 60 * 60_000 })
  if (blocked) return blocked

  const body = await req.json().catch(() => null)
  if (!body) return NextResponse.json({ error: 'بيانات غير صالحة' }, { status: 400 })

  const missing = REQUIRED_FIELDS.filter((field) => !text(body[field]))
  if (missing.length > 0) {
    return NextResponse.json({ error: 'يرجى تعبئة الحقول المطلوبة' }, { status: 400 })
  }

  const email = text(body.email, 180).toLowerCase()

  if (!isValidEmail(email)) {
    return NextResponse.json({ error: 'البريد الإلكتروني غير صحيح' }, { status: 400 })
  }
  if (body.acceptedTerms !== true) {
    return NextResponse.json({ error: 'يجب الموافقة على الشروط وسياسة الخصوصية' }, { status: 400 })
  }

  const existing = await prisma.trialRequest.findFirst({ where: { email } })
  if (existing) {
    return NextResponse.json({ error: 'يوجد طلب سابق لهذا البريد الإلكتروني' }, { status: 409 })
  }

  const trialRequest = await prisma.trialRequest.create({
    data: {
      officeName: text(body.officeName, 140),
      officeLicense: text(body.officeLicense, 80),
      city: text(body.city, 80),
      officePhone: text(body.officePhone, 40),
      address: nullableText(body.address),
      teamSize: nullableText(body.teamSize),
      specialty: nullableText(body.specialty),
      lawyerName: text(body.lawyerName, 120),
      lawyerBarNumber: text(body.lawyerBarNumber, 80),
      email,
      mobile: text(body.mobile, 40),
      nationalId: text(body.nationalId, 80),
      experience: nullableText(body.experience),
    },
  })

  return NextResponse.json({ ok: true, id: trialRequest.id }, { status: 201 })
})

export const GET = withErrorHandling(async (req: NextRequest) => {
  const auth = await requirePlatformAdmin(req)
  if (!auth.ok) return auth.response

  const requests = await prisma.trialRequest.findMany({ orderBy: { createdAt: 'desc' }, take: 1000 })
  return NextResponse.json(requests)
})
