import { NextRequest, NextResponse } from 'next/server'
import { revalidatePath } from 'next/cache'
import { requirePlatformAdmin } from '@/lib/auth-server'
import { rateLimit } from '@/lib/api-security'
import { auditLog } from '@/lib/audit'
import { withErrorHandling } from '@/lib/api-handler'
import { getSiteSettings, saveSiteSettings, type SiteSettingsUpdate } from '@/lib/site-settings'

const MAX_TICKER_ITEMS = 12
const MAX_TICKER_ITEM_LENGTH = 200
const HEX_COLOR = /^#[0-9a-fA-F]{6}$/
const YT_URL = /^https:\/\/(www\.)?(youtube\.com|youtu\.be)\//
const WHATSAPP_DIGITS = /^\d{8,15}$/
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

// GET is intentionally public and unauthenticated — used by the admin panel
// to populate its form. The landing page itself does NOT call this: it reads
// getSiteSettings() directly (no HTTP round trip), and its cached HTML is
// invalidated by the revalidatePath() call in PATCH below, not by this
// route. No Cache-Control here: it's a light, indexed single-row lookup, and
// caching it would only risk the admin seeing their own stale form.
export const GET = withErrorHandling(async () => {
  const settings = await getSiteSettings()
  return NextResponse.json(settings)
})

export const PATCH = withErrorHandling(async (req: NextRequest) => {
  const auth = await requirePlatformAdmin(req)
  if (!auth.ok) return auth.response
  const limited = rateLimit(req, `site-settings:update:${auth.user.id}`, { limit: 30, windowMs: 60 * 60_000 })
  if (limited) return limited

  const body = await req.json().catch(() => null)
  if (!body || typeof body !== 'object') return NextResponse.json({ error: 'بيانات غير صالحة' }, { status: 400 })

  const update: SiteSettingsUpdate = {}
  const changedFields: string[] = []

  if ('tickerItems' in body) {
    const items = body.tickerItems
    if (!Array.isArray(items) || items.length > MAX_TICKER_ITEMS || !items.every((i) => typeof i === 'string' && i.trim().length > 0 && i.length <= MAX_TICKER_ITEM_LENGTH)) {
      return NextResponse.json({ error: `شريط الإعلانات: نص واحد على الأقل، بحد أقصى ${MAX_TICKER_ITEMS} عناصر و${MAX_TICKER_ITEM_LENGTH} حرفاً لكل عنصر` }, { status: 400 })
    }
    update.tickerItems = items.map((i: string) => i.trim())
    changedFields.push('tickerItems')
  }
  if ('tickerBg' in body) {
    if (typeof body.tickerBg !== 'string' || !HEX_COLOR.test(body.tickerBg)) {
      return NextResponse.json({ error: 'لون خلفية الشريط يجب أن يكون كوداً سداسياً صحيحاً (#RRGGBB)' }, { status: 400 })
    }
    update.tickerBg = body.tickerBg
    changedFields.push('tickerBg')
  }
  if ('tickerColor' in body) {
    if (typeof body.tickerColor !== 'string' || !HEX_COLOR.test(body.tickerColor)) {
      return NextResponse.json({ error: 'لون نص الشريط يجب أن يكون كوداً سداسياً صحيحاً (#RRGGBB)' }, { status: 400 })
    }
    update.tickerColor = body.tickerColor
    changedFields.push('tickerColor')
  }
  if ('tickerSpeed' in body) {
    const speed = Number(body.tickerSpeed)
    if (!Number.isFinite(speed) || speed < 10 || speed > 120) {
      return NextResponse.json({ error: 'سرعة الشريط يجب أن تكون بين 10 و120 ثانية' }, { status: 400 })
    }
    update.tickerSpeed = Math.round(speed)
    changedFields.push('tickerSpeed')
  }
  if ('heroVideo' in body) {
    const v = body.heroVideo
    if (v === null) {
      update.heroVideo = null
    } else if (
      v && typeof v === 'object' &&
      (v.type === 'yt' || v.type === 'mp4') &&
      typeof v.url === 'string' && v.url.trim().length > 0 &&
      (v.type === 'mp4' ? /^https:\/\//.test(v.url) : YT_URL.test(v.url))
    ) {
      update.heroVideo = {
        type: v.type,
        url: v.url.trim(),
        autoplay: Boolean(v.autoplay),
        loop: Boolean(v.loop),
        controls: Boolean(v.controls),
      }
    } else {
      return NextResponse.json({ error: 'رابط الفيديو غير صالح — يجب أن يكون رابط YouTube أو رابط https مباشر لملف mp4' }, { status: 400 })
    }
    changedFields.push('heroVideo')
  }
  if ('contactPhone' in body) {
    if (typeof body.contactPhone !== 'string' || !body.contactPhone.trim()) {
      return NextResponse.json({ error: 'رقم الهاتف مطلوب' }, { status: 400 })
    }
    update.contactPhone = body.contactPhone.trim()
    changedFields.push('contactPhone')
  }
  if ('contactWhatsapp' in body) {
    const digits = typeof body.contactWhatsapp === 'string' ? body.contactWhatsapp.replace(/\D/g, '') : ''
    if (!WHATSAPP_DIGITS.test(digits)) {
      return NextResponse.json({ error: 'رقم واتساب يجب أن يتكون من 8 إلى 15 رقماً (مع رمز الدولة، بدون + أو مسافات)' }, { status: 400 })
    }
    update.contactWhatsapp = digits
    changedFields.push('contactWhatsapp')
  }
  if ('contactEmail' in body) {
    if (typeof body.contactEmail !== 'string' || !EMAIL.test(body.contactEmail.trim())) {
      return NextResponse.json({ error: 'أدخل بريداً إلكترونياً صحيحاً' }, { status: 400 })
    }
    update.contactEmail = body.contactEmail.trim()
    changedFields.push('contactEmail')
  }

  if (changedFields.length === 0) {
    return NextResponse.json({ error: 'لا توجد تغييرات للحفظ' }, { status: 400 })
  }

  await saveSiteSettings(update, auth.user)

  // The landing page reads settings directly in a Server Component, which
  // Next.js can prerender to a static, cached page (confirmed in the
  // production build — `/` comes out as ○ Static). Without this, a saved
  // change wouldn't reach visitors until the next deploy. This invalidates
  // that cached page so the very next request regenerates it with the new
  // settings — the actual mechanism behind "another session sees the
  // change," not just the DB write.
  revalidatePath('/')

  await auditLog(req, auth.user, 'site_settings.updated', {
    entityType: 'site_settings',
    metadata: { fields: changedFields },
  })

  const settings = await getSiteSettings()
  return NextResponse.json(settings)
})
