import { NextRequest, NextResponse } from 'next/server'
import { requireOfficeUser, requireVerifiedEmail } from '@/lib/auth-server'
import { rateLimit } from '@/lib/api-security'
import { auditLog } from '@/lib/audit'
import { withErrorHandling } from '@/lib/api-handler'
import { generateDraft, isLegalRagConfigured, LegalRagError } from '@/lib/ai/legal-rag-client'
import { completeAiCall, reserveAiCall } from '@/lib/ai/usage'

// Mirrors ailegal_hussein's own field spec for kind "contract"
// (ailegal_hussein/src/lib/drafting/forms.ts) — required fields match
// exactly what that service's Zod schema and prompt actually use; Dostoori's
// page collects the same set rather than inventing its own shape.
const REQUIRED_FIELDS = ['contract_type', 'party_one_name', 'party_two_name', 'subject']
const KNOWN_FIELDS = [
  'contract_type', 'contract_place', 'contract_date', 'jurisdiction',
  'party_one_name', 'party_one_id', 'party_one_address', 'party_one_capacity', 'party_one_representative',
  'party_two_name', 'party_two_id', 'party_two_address', 'party_two_capacity', 'party_two_representative',
  'subject', 'obligations_rights', 'consideration', 'duration', 'termination',
  'confidentiality', 'ip_terms', 'breach_terms', 'penalty_clause', 'force_majeure',
  'dispute_resolution', 'governing_law', 'special_terms',
]

export const POST = withErrorHandling(async (req: NextRequest) => {
  const auth = await requireOfficeUser(req)
  if (!auth.ok) return auth.response
  const unverified = requireVerifiedEmail(auth.user)
  if (unverified) return unverified

  const limited = rateLimit(req, `ai:contract-draft:${auth.user.id}`, { limit: 10, windowMs: 60 * 60_000 })
  if (limited) return limited

  const body = await req.json().catch(() => null)
  const rawFields = body?.fields && typeof body.fields === 'object' ? body.fields : {}
  const fields: Record<string, string> = {}
  for (const key of KNOWN_FIELDS) {
    const v = rawFields[key]
    if (typeof v === 'string' && v.trim()) fields[key] = v.trim().slice(0, 4000)
  }
  const notes = typeof body?.notes === 'string' ? body.notes.trim().slice(0, 2000) : ''

  const missing = REQUIRED_FIELDS.filter((f) => !fields[f])
  if (missing.length > 0 && notes.length < 20) {
    return NextResponse.json({ error: `حقول مطلوبة ناقصة: ${missing.join('، ')}` }, { status: 400 })
  }

  if (!isLegalRagConfigured()) {
    return NextResponse.json({ error: 'خدمة صياغة العقود بالذكاء الاصطناعي غير مُفعّلة على هذا الخادم حالياً' }, { status: 503 })
  }
  const reservation = await reserveAiCall(auth.user, 'contract_draft', { payload: JSON.stringify([fields, notes]) })
  if (!reservation.ok) return NextResponse.json({ error: reservation.message, code: reservation.reason }, { status: reservation.reason === 'duplicate_in_flight' ? 409 : 429 })

  const start = Date.now()
  try {
    const result = await generateDraft('contract', fields, notes, auth.user)

    await auditLog(req, auth.user, 'ai.contract_drafted', {
      metadata: { grounded: result.grounded, groundingLevel: result.groundingLevel, sourceCount: result.sources.length, contractType: fields.contract_type },
    })
    await completeAiCall(reservation.id, {
      success: true,
      latencyMs: Date.now() - start,
      usage: result.usage,
      model: result.provenance.chatModels.join(',') || undefined,
      groundingLevel: result.groundingLevel,
    })

    return NextResponse.json({
      draft: result.draft,
      grounded: result.grounded,
      groundingLevel: result.groundingLevel,
      mode: result.mode,
      // Dates / amounts / ids the model wrote that the lawyer never supplied
      // were replaced with "[يُستكمل: …]" by the engine; this is their count.
      unverifiedFacts: result.unverifiedFacts,
      // Phase 2.1: supplied fields (names, court, dates) the draft does not
      // carry as the lawyer wrote them — review before filing.
      missingSuppliedFields: result.missingSuppliedFields,
      sources: result.sources,
      sourceAuthority: result.sourceAuthority,
    })
  } catch (err) {
    const ragError = err instanceof LegalRagError ? err : null
    await completeAiCall(reservation.id, { success: false, latencyMs: Date.now() - start, errorCode: ragError ? ragError.code : 'unknown_error' })
    if (ragError) return NextResponse.json({ error: ragError.message }, { status: ragError.status })
    console.error('[ai/contract-draft] unexpected failure', err)
    return NextResponse.json({ error: 'تعذّر توليد مسودة العقد حالياً' }, { status: 502 })
  }
})
