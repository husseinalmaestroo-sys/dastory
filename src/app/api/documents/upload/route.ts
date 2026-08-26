import { NextRequest, NextResponse } from 'next/server'
import { writeFile, mkdir } from 'fs/promises'
import { join } from 'path'
import { randomUUID } from 'crypto'
import { prisma } from '@/lib/prisma'
import { requireOfficeUser } from '@/lib/auth-server'
import { caseVisibilityWhere } from '@/lib/tenant-scope'
import { rateLimit } from '@/lib/api-security'
import { auditLog } from '@/lib/audit'
import { notifyUser } from '@/lib/notify'

const ALLOWED_TYPES = new Set(['PDF', 'DOC', 'DOCX', 'XLS', 'XLSX', 'PNG', 'JPG', 'JPEG', 'TXT'])
const ALLOWED_MIME_PREFIXES = ['application/pdf', 'application/msword', 'application/vnd.', 'image/png', 'image/jpeg', 'text/plain']

function hasPrefix(buffer: Buffer, bytes: number[]) {
  return bytes.every((byte, index) => buffer[index] === byte)
}

function hasValidSignature(ext: string, buffer: Buffer) {
  if (ext === 'PDF') return buffer.subarray(0, 4).toString('ascii') === '%PDF'
  if (ext === 'PNG') return hasPrefix(buffer, [0x89, 0x50, 0x4e, 0x47])
  if (ext === 'JPG' || ext === 'JPEG') return hasPrefix(buffer, [0xff, 0xd8, 0xff])
  if (ext === 'DOC' || ext === 'XLS') return hasPrefix(buffer, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])
  if (ext === 'DOCX' || ext === 'XLSX') return buffer.subarray(0, 2).toString('ascii') === 'PK'
  if (ext === 'TXT') return !buffer.subarray(0, Math.min(buffer.length, 1024)).includes(0)
  return false
}

export async function POST(req: NextRequest) {
  try {
    const auth = await requireOfficeUser(req)
    if (!auth.ok) return auth.response
    const limited = rateLimit(req, `documents:upload:${auth.user.id}`, { limit: 30, windowMs: 60 * 60_000 })
    if (limited) return limited

    const formData = await req.formData()
    const file = formData.get('file') as File | null
    const caseId = (formData.get('caseId') as string) || null

    if (!file || file.size === 0) return NextResponse.json({ error: 'لم يتم اختيار ملف' }, { status: 400 })
    if (file.size > 20 * 1024 * 1024) return NextResponse.json({ error: 'حجم الملف يتجاوز 20MB' }, { status: 400 })

    const ext = (file.name.split('.').pop() ?? '').toUpperCase()
    if (!ALLOWED_TYPES.has(ext)) {
      return NextResponse.json({ error: 'نوع الملف غير مدعوم' }, { status: 400 })
    }
    if (file.type && !ALLOWED_MIME_PREFIXES.some((mime) => file.type.startsWith(mime))) {
      return NextResponse.json({ error: 'نوع الملف لا يطابق الامتداد' }, { status: 400 })
    }

    let linkedCase: { id: string; number: string; ownerId: string } | null = null
    if (caseId) {
      linkedCase = await prisma.case.findFirst({
        where: caseVisibilityWhere(auth.user, { id: caseId }),
        select: { id: true, number: true, ownerId: true },
      })
      if (!linkedCase) return NextResponse.json({ error: 'القضية غير موجودة' }, { status: 404 })
    }

    const bytes = Buffer.from(await file.arrayBuffer())
    if (!hasValidSignature(ext, bytes)) {
      return NextResponse.json({ error: 'محتوى الملف لا يطابق نوعه' }, { status: 400 })
    }

    const uploadDir = join(process.cwd(), 'storage', 'case-documents', auth.user.officeId, auth.user.id)
    await mkdir(uploadDir, { recursive: true })

    const safeName = file.name
      .replace(/[^\w.\u0600-\u06FF-]/g, '_')
      .replace(/_+/g, '_')
      .slice(0, 120)
    const uniqueName = `${Date.now()}-${randomUUID()}-${safeName || `document.${ext.toLowerCase()}`}`
    await writeFile(join(uploadDir, uniqueName), bytes)
    const storedPath = ['case-documents', auth.user.officeId, auth.user.id, uniqueName].join('/')

    const doc = await prisma.document.create({
      data: {
        name: file.name,
        type: ext,
        size: file.size,
        url: storedPath,
        caseId: caseId || null,
        officeId: auth.user.officeId,
        ownerId: auth.user.id,
      },
      include: { case: { select: { number: true, title: true } } },
    })

    await auditLog(req, auth.user, 'document.uploaded', {
      entityType: 'document',
      entityId: doc.id,
      metadata: { type: doc.type, size: doc.size, caseId: doc.caseId },
    })
    if (linkedCase && linkedCase.ownerId !== auth.user.id) {
      await notifyUser(linkedCase.ownerId, auth.user.officeId, 'مستند جديد', `تم رفع مستند جديد على قضية ${linkedCase.number}: ${doc.name}`)
    }
    return NextResponse.json({ ...doc, url: `/api/documents/${doc.id}/download` })
  } catch (err) {
    console.error(err)
    return NextResponse.json({ error: 'خطأ في الخادم' }, { status: 500 })
  }
}
