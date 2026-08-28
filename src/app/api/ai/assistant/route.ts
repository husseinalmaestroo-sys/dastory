import { NextRequest, NextResponse } from 'next/server'
import { requireOfficeUser } from '@/lib/auth-server'
import { rateLimit } from '@/lib/api-security'
import { withErrorHandling } from '@/lib/api-handler'
import { AI_CONFIGURED, AI_MAX_OUTPUT_TOKENS, AI_MODEL, AI_REQUEST_TIMEOUT_MS, getAnthropicClient } from '@/lib/ai/client'
import { isUnderMonthlyAiCap, logAiUsage } from '@/lib/ai/usage'

const MAX_MESSAGE_LENGTH = 4000
const MAX_HISTORY_MESSAGES = 12 // caps context size -> caps cost per request

const SYSTEM_PROMPT = `أنت مساعد قانوني عام يتحدث العربية، يقدّم معلومات تمهيدية عامة متعلقة بالسياق الأردني.
قيود صارمة يجب الالتزام بها دائماً:
- أنت لست محامياً مرخصاً ولا تقدّم استشارة قانونية ملزمة أو نهائية.
- ليس لديك اتصال بقاعدة بيانات تشريعية أو قضائية موثّقة أو محدَّثة — لا تستشهد بأرقام مواد قانونية أو أحكام قضائية محددة كأنها مؤكدة، ولا تختلق أسماء قضايا أو قرارات محاكم.
- عند عدم التأكد، صرّح بذلك بوضوح واطلب من المستخدم التحقق من محامٍ مرخّص أو من النص الرسمي للتشريع.
- كل إجابة يجب أن تتضمن تذكيراً بأن هذه معلومات عامة تحتاج تحققاً من مختص، وليست استشارة قانونية نهائية.
أجب بإيجاز ووضوح.`

// Validation order is deliberate: auth -> rate limit -> input shape -> is
// the document/service even reachable -> monthly cost cap -> the actual
// (expensive, provider-calling) work. Client-fixable errors (bad input,
// wrong tenant) should never be masked by "service unavailable" just
// because AI happens to be unconfigured in this environment — a caller
// sending garbage should learn that regardless of provider config.
export const POST = withErrorHandling(async (req: NextRequest) => {
  const auth = await requireOfficeUser(req)
  if (!auth.ok) return auth.response

  // Tight per-user burst limit; isUnderMonthlyAiCap below covers total
  // monthly spend, which a burst limit alone doesn't bound.
  const limited = rateLimit(req, `ai:assistant:${auth.user.id}`, { limit: 20, windowMs: 60 * 60_000 })
  if (limited) return limited

  const body = await req.json().catch(() => null)
  const message = typeof body?.message === 'string' ? body.message.trim() : ''
  const history = Array.isArray(body?.history) ? body.history : []

  if (!message) return NextResponse.json({ error: 'أدخل سؤالاً' }, { status: 400 })
  if (message.length > MAX_MESSAGE_LENGTH) {
    return NextResponse.json({ error: `السؤال طويل جداً (الحد الأقصى ${MAX_MESSAGE_LENGTH} حرفاً)` }, { status: 400 })
  }

  if (!AI_CONFIGURED) {
    return NextResponse.json({ error: 'خدمة المساعد الذكي غير مُفعّلة على هذا الخادم حالياً' }, { status: 503 })
  }
  if (!(await isUnderMonthlyAiCap(auth.user.officeId))) {
    return NextResponse.json({ error: 'تم بلوغ الحد الشهري لاستخدام المساعد الذكي لهذا المكتب' }, { status: 429 })
  }
  const cleanHistory = history
    .filter((m: unknown): m is { role: string; text: string } =>
      !!m && typeof m === 'object' && ('role' in m) && ('text' in m) &&
      (m as any).role && typeof (m as any).text === 'string' && (m as any).text.length <= MAX_MESSAGE_LENGTH
    )
    .slice(-MAX_HISTORY_MESSAGES)
    .map((m: { role: string; text: string }) => ({
      role: m.role === 'u' ? ('user' as const) : ('assistant' as const),
      content: m.text,
    }))

  const start = Date.now()
  try {
    const client = getAnthropicClient()
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), AI_REQUEST_TIMEOUT_MS)

    const response = await client.messages.create(
      {
        model: AI_MODEL,
        max_tokens: AI_MAX_OUTPUT_TOKENS,
        system: SYSTEM_PROMPT,
        messages: [...cleanHistory, { role: 'user', content: message }],
      },
      { signal: controller.signal }
    ).finally(() => clearTimeout(timeout))

    const text = response.content.find((b) => b.type === 'text')?.text ?? ''

    await logAiUsage(auth.user, 'assistant', {
      model: AI_MODEL,
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
      latencyMs: Date.now() - start,
      success: true,
    })

    return NextResponse.json({
      text,
      disclaimer: 'معلومات عامة تحتاج تحققاً من محامٍ مرخّص — ليست استشارة قانونية نهائية.',
    })
  } catch (err) {
    const isAbort = err instanceof Error && err.name === 'AbortError'
    await logAiUsage(auth.user, 'assistant', {
      model: AI_MODEL, inputTokens: 0, outputTokens: 0,
      latencyMs: Date.now() - start, success: false,
      errorCode: isAbort ? 'timeout' : 'provider_error',
    })
    console.error('[ai/assistant] provider call failed', isAbort ? 'timeout' : err)
    return NextResponse.json(
      { error: isAbort ? 'انتهت مهلة الاستجابة، حاول مرة أخرى' : 'تعذّر الاتصال بخدمة الذكاء الاصطناعي' },
      { status: isAbort ? 504 : 502 }
    )
  }
})
