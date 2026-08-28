import { getSiteSettings } from '@/lib/site-settings'
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

export default async function LandingPage() {
  const settings = await getSiteSettings()

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
