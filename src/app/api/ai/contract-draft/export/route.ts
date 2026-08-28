import { NextRequest, NextResponse } from 'next/server'
import { requireOfficeUser } from '@/lib/auth-server'
import { rateLimit } from '@/lib/api-security'
import { withErrorHandling } from '@/lib/api-handler'
import { exportDraft, LegalRagError } from '@/lib/ai/legal-rag-client'

// No AI provider call here (ailegal_hussein's own export endpoint is pure
// formatting, not gated behind its lawyer auth either — see its
// src/app/api/draft/export/route.ts) — still auth+tenant-gated on Dostoori's
// side like everything else, just no monthly AI cap or isLegalRagConfigured
// check, since generating the draft (contract-draft/route.ts) already
// required both before this text existed at all.
export const POST = withErrorHandling(async (req: NextRequest) => {
  const auth = await requireOfficeUser(req)
  if (!auth.ok) return auth.response

  const limited = rateLimit(req, `ai:contract-draft-export:${auth.user.id}`, { limit: 20, windowMs: 60 * 60_000 })
  if (limited) return limited

  const body = await req.json().catch(() => null)
  const draft = typeof body?.draft === 'string' ? body.draft : ''
  const filename = typeof body?.filename === 'string' && body.filename.trim() ? body.filename.trim().slice(0, 100) : 'عقد'
  const format = body?.format === 'pdf' ? 'pdf' : 'docx'
  if (!draft.trim()) return NextResponse.json({ error: 'لا يوجد نص عقد لتصديره' }, { status: 400 })

  try {
    const file = await exportDraft(draft, filename, format, auth.user.officeId)
    return new NextResponse(new Uint8Array(file.buffer), {
      headers: {
        'Content-Type': file.contentType,
        'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(filename)}.${format}`,
      },
    })
  } catch (err) {
    const ragError = err instanceof LegalRagError ? err : null
    if (ragError) return NextResponse.json({ error: ragError.message }, { status: ragError.status })
    console.error('[ai/contract-draft/export] unexpected failure', err)
    return NextResponse.json({ error: 'تعذّر تصدير الملف حالياً' }, { status: 502 })
  }
})
