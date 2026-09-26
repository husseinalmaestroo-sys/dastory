import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

// Business rule for signed documents (DocumentSignature rows are the audit
// trail proving who signed what, when, against which content hash):
// neither a signed document, nor the signature image attached to it, nor a
// case containing either may be deleted. The deletion is refused with a
// 409 that says why — the trail is never silently destroyed, and never
// turns into the unhandled foreign-key 500 it used to be. To retire such a
// case, close it (status CLOSED) instead.

export async function documentIsInSignatureTrail(documentId: string): Promise<boolean> {
  const count = await prisma.documentSignature.count({
    where: { OR: [{ documentId }, { signatureImageId: documentId }] },
  })
  return count > 0
}

export async function caseHasSignatureTrail(caseId: string): Promise<boolean> {
  const count = await prisma.documentSignature.count({
    where: { OR: [{ document: { caseId } }, { signatureImage: { caseId } }] },
  })
  return count > 0
}

export function signedDocumentConflict(kind: 'document' | 'case'): NextResponse {
  return NextResponse.json(
    {
      error: kind === 'document'
        ? 'لا يمكن حذف مستند موقَّع أو صورة توقيع مرتبطة بسجل توقيع — سجل التوقيع جزء من الأثر التدقيقي'
        : 'لا يمكن حذف قضية تحتوي مستندات موقَّعة — سجل التوقيع جزء من الأثر التدقيقي. يمكنك إغلاق القضية بدلاً من حذفها',
      code: 'signed_document',
    },
    { status: 409 }
  )
}
