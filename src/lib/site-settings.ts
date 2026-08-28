import { prisma } from '@/lib/prisma'

// Single well-known row id — see the SiteSettings model comment in
// prisma/schema.prisma for why this is a singleton table.
const SETTINGS_ID = 'singleton'

export interface SiteSettingsData {
  tickerItems: string[]
  tickerBg: string
  tickerColor: string
  tickerSpeed: number
  heroVideo: { type: 'yt' | 'mp4'; url: string; autoplay: boolean; loop: boolean; controls: boolean } | null
  contactPhone: string
  contactWhatsapp: string
  contactEmail: string
}

export const SITE_SETTINGS_DEFAULTS: SiteSettingsData = {
  tickerItems: [
    '✦ للتواصل مع دُسْتُورِي عبر واتساب: +962 79 000 0000',
    '✦ احجز الآن واكتشف نظام إدارة القضايا والتشريعات من مكان واحد',
    '✦ عروض إطلاق خاصة لمكاتب المحاماة الأردنية — 3 أشهر مجاناً',
    '✦ منصة دُسْتُورِي — منظومة المحامي الذكي',
  ],
  tickerBg: '#0F172A',
  tickerColor: '#D4AF37',
  tickerSpeed: 40,
  heroVideo: null,
  contactPhone: '+962 79 000 0000',
  contactWhatsapp: '9627900000001',
  contactEmail: 'info@dostoori.jo',
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((v) => typeof v === 'string')
}

/**
 * Reads the current public site settings. No row exists until the first
 * admin save — that's not an error, it just means every visitor sees the
 * built-in defaults (same content that used to be hardcoded/localStorage).
 * Read-only: deliberately does NOT create the row, so this cheap query run
 * on every landing-page visit never turns into a write.
 */
export async function getSiteSettings(): Promise<SiteSettingsData> {
  const row = await prisma.siteSettings.findUnique({ where: { id: SETTINGS_ID } })
  if (!row) return SITE_SETTINGS_DEFAULTS

  const tickerItems = isStringArray(row.tickerItems) && row.tickerItems.length > 0
    ? row.tickerItems
    : SITE_SETTINGS_DEFAULTS.tickerItems

  return {
    tickerItems,
    tickerBg: row.tickerBg,
    tickerColor: row.tickerColor,
    tickerSpeed: row.tickerSpeed,
    heroVideo: row.heroVideoUrl && (row.heroVideoType === 'yt' || row.heroVideoType === 'mp4')
      ? {
          type: row.heroVideoType,
          url: row.heroVideoUrl,
          autoplay: row.heroVideoAutoplay,
          loop: row.heroVideoLoop,
          controls: row.heroVideoControls,
        }
      : null,
    contactPhone: row.contactPhone,
    contactWhatsapp: row.contactWhatsapp,
    contactEmail: row.contactEmail,
  }
}

export type SiteSettingsUpdate = Partial<SiteSettingsData>

export async function saveSiteSettings(
  update: SiteSettingsUpdate,
  actor: { id: string; email: string }
) {
  const current = await getSiteSettings()
  const next: SiteSettingsData = {
    ...current,
    ...update,
    heroVideo: update.heroVideo !== undefined ? update.heroVideo : current.heroVideo,
  }

  const row = await prisma.siteSettings.upsert({
    where: { id: SETTINGS_ID },
    create: {
      id: SETTINGS_ID,
      tickerItems: next.tickerItems,
      tickerBg: next.tickerBg,
      tickerColor: next.tickerColor,
      tickerSpeed: next.tickerSpeed,
      heroVideoType: next.heroVideo?.type ?? null,
      heroVideoUrl: next.heroVideo?.url ?? null,
      heroVideoAutoplay: next.heroVideo?.autoplay ?? true,
      heroVideoLoop: next.heroVideo?.loop ?? true,
      heroVideoControls: next.heroVideo?.controls ?? false,
      contactPhone: next.contactPhone,
      contactWhatsapp: next.contactWhatsapp,
      contactEmail: next.contactEmail,
      updatedById: actor.id,
      updatedByEmail: actor.email,
    },
    update: {
      tickerItems: next.tickerItems,
      tickerBg: next.tickerBg,
      tickerColor: next.tickerColor,
      tickerSpeed: next.tickerSpeed,
      heroVideoType: next.heroVideo?.type ?? null,
      heroVideoUrl: next.heroVideo?.url ?? null,
      heroVideoAutoplay: next.heroVideo?.autoplay ?? true,
      heroVideoLoop: next.heroVideo?.loop ?? true,
      heroVideoControls: next.heroVideo?.controls ?? false,
      contactPhone: next.contactPhone,
      contactWhatsapp: next.contactWhatsapp,
      contactEmail: next.contactEmail,
      updatedById: actor.id,
      updatedByEmail: actor.email,
    },
  })

  return row
}
