import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireOfficeUser } from '@/lib/auth-server'
import { documentVisibilityWhere } from '@/lib/tenant-scope'
import { rateLimit } from '@/lib/api-security'
import { auditLog, getRequestIp } from '@/lib/audit'
import { withErrorHandling } from '@/lib/api-handler'
import { deleteDocumentFile, readDocumentFile, writeDocumentFile } from '@/lib/document-storage'
import { DISCLOSURE_TEXT, sha256Hex } from '@/lib/signature'
import { fitFileName } from '@/lib/validation'

type RouteContext = { params: Promise<{ id: string }> }

function hasPngSignature(buffer: Buffer) {
  const sig = [0x89, 0x50, 0x4e, 0x47]
  return sig.every((byte, index) => buffer[index] === byte)
}

// Records a real, verifiable fact — this signer, at this time, attached
// this drawn-image file while the target document's bytes hashed to X — not
// a "legally binding e-signature" claim. See src/lib/signature.ts.
export const POST = withErrorHandling(async (req: NextRequest, { params }: RouteContext) => {
  const auth = await requireOfficeUser(req)
  if (!auth.ok) return auth.response
  const limited = rateLimit(req, `documents:sign:${auth.user.id}`, { limit: 20, windowMs: 60 * 60_000 })
  if (limited) return limited

  const { id } = await params
  const targetDoc = await prisma.document.findFirst({ where: documentVisibilityWhere(auth.user, { id }) })
  if (!targetDoc || !targetDoc.url) return NextResponse.json({ error: 'المستند غير موجود' }, { status: 404 })

  const formData = await req.formData().catch(() => null)
  const file = formData?.get('signatureImage') as File | null
  if (!file || file.size === 0) return NextResponse.json({ error: 'لا يوجد توقيع مرسوم' }, { status: 400 })
  if (file.size > 2 * 1024 * 1024) return NextResponse.json({ error: 'حجم صورة التوقيع كبير جداً' }, { status: 400 })

  const imageBytes = Buffer.from(await file.arrayBuffer())
  if (!hasPngSignature(imageBytes)) {
    return NextResponse.json({ error: 'صورة التوقيع غير صالحة' }, { status: 400 })
  }

  let targetBytes: Buffer
  try {
    targetBytes = await readDocumentFile(targetDoc.url)
  } catch {
    return NextResponse.json({ error: 'تعذّر قراءة المستند المطلوب توقيعه' }, { status: 404 })
  }
  const documentHash = sha256Hex(targetBytes)

  const storedPath = await writeDocumentFile(
    auth.user.officeId, auth.user.id,
    `توقيع-${targetDoc.name}.png`, 'PNG', imageBytes
  )

  let result
  try {
    result = await prisma.$transaction(async (tx) => {
      const signatureDoc = await tx.document.create({
        data: {
          name: fitFileName(`توقيع - ${targetDoc.name}.png`),
          type: 'PNG',
          size: imageBytes.length,
          url: storedPath,
          caseId: targetDoc.caseId,
          officeId: auth.user.officeId,
          ownerId: auth.user.id,
        },
      })
      const signature = await tx.documentSignature.create({
        data: {
          documentId: targetDoc.id,
          signatureImageId: signatureDoc.id,
          signerId: auth.user.id,
          officeId: auth.user.officeId,
          documentHash,
          ipAddress: getRequestIp(req),
        },
      })
      return { signatureDoc, signature }
    })
  } catch (err) {
    // The image file was written before the transaction; don't orphan it.
    await deleteDocumentFile(storedPath)
    throw err
  }

  await auditLog(req, auth.user, 'document.signed', {
    entityType: 'document',
    entityId: targetDoc.id,
    metadata: { signatureId: result.signature.id, documentHash },
  })

  return NextResponse.json({
    id: result.signature.id,
    signedAt: result.signature.signedAt,
    documentHash: result.signature.documentHash,
    signerName: auth.user.name,
    disclosure: DISCLOSURE_TEXT,
  }, { status: 201 })
})

// Audit trail — who signed this document, when, and whether the document's
// current bytes still match what was hashed at signing time (tamper check:
// a mismatch means the underlying file was replaced/modified after signing).
export const GET = withErrorHandling(async (req: NextRequest, { params }: RouteContext) => {
  const auth = await requireOfficeUser(req)
  if (!auth.ok) return auth.response

  const { id } = await params
  const targetDoc = await prisma.document.findFirst({ where: documentVisibilityWhere(auth.user, { id }) })
  if (!targetDoc) return NextResponse.json({ error: 'المستند غير موجود' }, { status: 404 })

  const signatures = await prisma.documentSignature.findMany({
    where: { documentId: id },
    include: { signer: { select: { name: true, email: true } } },
    orderBy: { signedAt: 'desc' },
  })

  let currentHash: string | null = null
  if (targetDoc.url) {
    try {
      currentHash = sha256Hex(await readDocumentFile(targetDoc.url))
    } catch { /* file missing — tamper status simply can't be computed */ }
  }

  return NextResponse.json({
    disclosure: DISCLOSURE_TEXT,
    signatures: signatures.map((s) => ({
      id: s.id,
      signedAt: s.signedAt,
      signerName: s.signer.name,
      signerEmail: s.signer.email,
      documentHash: s.documentHash,
      matchesCurrentDocument: currentHash !== null ? currentHash === s.documentHash : null,
    })),
  })
})
