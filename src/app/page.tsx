import { connection } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { getSiteSettings, SITE_SETTINGS_DEFAULTS, type SiteSettingsData } from '@/lib/site-settings'
import Ticker from '@/components/landing/Ticker'
import Navbar from '@/components/landing/Navbar'
import Hero from '@/components/landing/Hero'
import Stats from '@/components/landing/Stats'
import Features from '@/components/landing/Features'
import AIEngine from '@/components/landing/AIEngine'
import OfficeManagement from '@/components/landing/OfficeManagement'
import Comparison from '@/components/landing/Comparison'
import Packages from '@/components/landing/Packages'
import RegistrationForm from '@/components/landing/RegistrationForm'
import FAQ from '@/components/landing/FAQ'
import Footer from '@/components/landing/Footer'
import WhatsAppFloatButton from '@/components/landing/WhatsAppFloatButton'
import ScrollReveal from '@/components/landing/ScrollReveal'

// Rendered per request, never prerendered at build time: `connection()`
// stops prerendering before the DB read. Prerendering used to query
// SiteSettings from MySQL during `next build`, so a build without a live,
// migrated database (the Docker build stage) failed outright. The query is a
// single primary-key lookup.
async function loadSettings(): Promise<SiteSettingsData> {
  await connection()
  try {
    return await getSiteSettings()
  } catch (err) {
    // Keep the public landing page up during a DB outage (it then shows the
    // built-in defaults — the same content shown before any admin edit), but
    // never silently: the failure is logged and sent to Sentry.
    console.error('[landing] site settings unavailable, rendering defaults', err)
    Sentry.captureException(err)
    return SITE_SETTINGS_DEFAULTS
  }
}

export default async function LandingPage() {
  const settings = await loadSettings()

  return (
    <>
      <WhatsAppFloatButton whatsapp={settings.contactWhatsapp} />
      <ScrollReveal />

      <Ticker items={settings.tickerItems} bg={settings.tickerBg} color={settings.tickerColor} speed={settings.tickerSpeed} />
      <Navbar whatsapp={settings.contactWhatsapp} />
      <Hero video={settings.heroVideo} />
      <Stats />
      <Features />
      <AIEngine />
      <OfficeManagement />
      <Comparison />
      <Packages />
      <RegistrationForm />
      <FAQ />
      <Footer phone={settings.contactPhone} email={settings.contactEmail} />
    </>
  )
}
