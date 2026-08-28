import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireOfficeUser } from '@/lib/auth-server'
import { documentVisibilityWhere } from '@/lib/tenant-scope'
import { rateLimit } from '@/lib/api-security'
import { auditLog } from '@/lib/audit'
import { withErrorHandling } from '@/lib/api-handler'
import { analyzeCaseFile, isLegalRagConfigured, LegalRagError } from '@/lib/ai/legal-rag-client'
import { isUnderMonthlyAiCap, logAiUsage } from '@/lib/ai/usage'
import { readDocumentFile } from '@/lib/document-storage'

// Same order as every other AI route: auth -> rate limit -> input shape ->
// tenant-scoped lookup (cross-office documentId must 404 regardless of
// config) -> is the service even reachable -> monthly cost cap -> the
// expensive part. Analyzes a *dispute* file (parties as plaintiff/
// defendant, possible defenses) via ailegal_hussein's /api/cases — not a
// bilateral agreement, which is why contract-review (route.ts next to this
// one) stays on its current Claude-based path instead of this endpoint.
export const POST = withErrorHandling(async (req: NextRequest) => {
  const auth = await requireOfficeUser(req)
  if (!auth.ok) return auth.response

  const limited = rateLimit(req, `ai:case-analysis:${auth.user.id}`, { limit: 10, windowMs: 60 * 60_000 })
  if (limited) return limited

  const body = await req.json().catch(() => null)
  const documentId = typeof body?.documentId === 'string' ? body.documentId : ''
  if (!documentId) return NextResponse.json({ error: 'المستند مطلوب' }, { status: 400 })

  const doc = await prisma.document.findFirst({ where: documentVisibilityWhere(auth.user, { id: documentId }) })
  if (!doc || !doc.url) return NextResponse.json({ error: 'المستند غير موجود' }, { status: 404 })

  if (!isLegalRagConfigured()) {
    return NextResponse.json({ error: 'خدمة تحليل القضايا بالذكاء الاصطناعي غير مُفعّلة على هذا الخادم حالياً' }, { status: 503 })
  }
  if (!(await isUnderMonthlyAiCap(auth.user.officeId))) {
    return NextResponse.json({ error: 'تم بلوغ الحد الشهري لاستخدام أدوات الذكاء الاصطناعي لهذا المكتب' }, { status: 429 })
  }

  let bytes: Buffer
  try {
    bytes = await readDocumentFile(doc.url)
  } catch {
    return NextResponse.json({ error: 'تعذّر قراءة الملف من التخزين' }, { status: 404 })
  }

  const start = Date.now()
  try {
    const result = await analyzeCaseFile(bytes, doc.name, auth.user.officeId)

    await auditLog(req, auth.user, 'ai.case_analyzed', {
      entityType: 'document', entityId: doc.id,
      metadata: { extractionMethod: result.extractionMethod, sourceCount: result.sources.length },
    })
    await logAiUsage(auth.user, 'case_analysis', {
      model: 'ailegal_hussein', inputTokens: 0, outputTokens: 0,
      latencyMs: Date.now() - start, success: true,
    })

    return NextResponse.json(result)
  } catch (err) {
    const ragError = err instanceof LegalRagError ? err : null
    await logAiUsage(auth.user, 'case_analysis', {
      model: 'ailegal_hussein', inputTokens: 0, outputTokens: 0,
      latencyMs: Date.now() - start, success: false,
      errorCode: ragError ? String(ragError.status) : 'unknown_error',
    })
    if (ragError) return NextResponse.json({ error: ragError.message }, { status: ragError.status })
    console.error('[ai/case-analysis] unexpected failure', err)
    return NextResponse.json({ error: 'تعذّر تحليل ملف القضية حالياً' }, { status: 502 })
  }
})
