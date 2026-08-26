'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { getContactSettings, CS_EVENT, CS_DEFAULTS } from '@/lib/contact-settings'

export default function Navbar() {
  const navRef = useRef<HTMLElement>(null)
  const [mobileOpen, setMobileOpen] = useState(false)
  const [wa, setWa] = useState(CS_DEFAULTS.whatsapp)

  useEffect(() => {
    const load = () => setWa(getContactSettings().whatsapp)
    load()
    window.addEventListener(CS_EVENT, load)
    return () => window.removeEventListener(CS_EVENT, load)
  }, [])

  useEffect(() => {
    const onScroll = () => {
      if (navRef.current) {
        navRef.current.style.boxShadow = window.scrollY > 10
          ? '0 4px 24px rgba(0,0,0,.08)'
          : 'none'
      }
    }
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  const NAV = [
    { label: 'الميزات',           href: '#features' },
    { label: 'الذكاء الاصطناعي', href: '#ai-engine' },
    { label: 'لماذا نحن؟',        href: '#comparison' },
    { label: 'الأسئلة الشائعة',  href: '#faq'      },
  ]

  const linkStyle: React.CSSProperties = {
    padding: '9px 16px', borderRadius: 9,
    fontFamily: "'Cairo', sans-serif", fontSize: 13.5, fontWeight: 700,
    color: '#64748B', textDecoration: 'none', transition: 'color .15s, background .15s',
  }

  return (
    <nav
      ref={navRef}
      id="nav"
      style={{ position: 'sticky', top: 0, zIndex: 100, background: '#fff', borderBottom: '1px solid #E8E8E8', transition: 'box-shadow .3s' }}
    >
      <div style={{ maxWidth: 1280, margin: '0 auto', padding: '0 24px', height: 68, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16 }}>

        {/* Logo */}
        <Link href="/" style={{ display: 'flex', alignItems: 'center', gap: 10, textDecoration: 'none', flexShrink: 0 }}>
          <div className="g-gold" style={{ width: 38, height: 38, borderRadius: 11, display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 4px 12px rgba(200,168,75,.35)' }}>
            <svg width="20" height="20" fill="none" stroke="white" strokeWidth="1.8" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 21h18M3 10h18M3 7l9-4 9 4M4 10v11M20 10v11M8 10v11M16 10v11M12 7v14"/>
            </svg>
          </div>
          <div style={{ lineHeight: 1.1 }}>
            <div style={{ fontSize: 18, fontWeight: 900, color: 'var(--navy)' }}>دُسْتُورِي</div>
            <div style={{ fontSize: 8, fontWeight: 700, letterSpacing: 2.5, color: '#94A3B8', textTransform: 'uppercase' }}>DOSTOORI LEGAL</div>
          </div>
        </Link>

        {/* Desktop Nav */}
        <div className="nav-links">
          {NAV.map((item) => (
            <a
              key={item.href}
              href={item.href}
              style={linkStyle}
              onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--navy)'; e.currentTarget.style.background = 'rgba(200,168,75,.08)' }}
              onMouseLeave={(e) => { e.currentTarget.style.color = '#64748B'; e.currentTarget.style.background = 'transparent' }}
            >
              {item.label}
            </a>
          ))}
        </div>

        {/* Right side: CTAs + Hamburger */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
          <Link href="/dashboard" className="nav-cta-login" style={{ fontSize: 13, fontWeight: 800, color: 'var(--navy)', border: '2px solid #CBD5E1', borderRadius: 10, padding: '8px 18px', textDecoration: 'none' }}>
            تسجيل الدخول
          </Link>
          <a href={`https://wa.me/${wa}?text=${encodeURIComponent('مرحباً، أريد حجز Demo لنظام دُسْتُورِي')}`} target="_blank" rel="noreferrer" className="g-gold" style={{ fontSize: 13, fontWeight: 900, color: '#fff', borderRadius: 10, padding: '9px 24px', textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 7, boxShadow: '0 4px 16px rgba(200,168,75,.4)', whiteSpace: 'nowrap' }}>
            <svg width="15" height="15" fill="white" viewBox="0 0 24 24">
              <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z"/><path d="M12 0C5.373 0 0 5.373 0 12c0 2.115.55 4.101 1.51 5.829L0 24l6.335-1.484A11.945 11.945 0 0012 24c6.627 0 12-5.373 12-12S18.627 0 12 0zm0 22c-1.885 0-3.651-.513-5.168-1.406l-.371-.22-3.762.881.895-3.665-.242-.378A9.944 9.944 0 012 12C2 6.477 6.477 2 12 2s10 4.477 10 10-4.477 10-10 10z"/>
            </svg>
            احجز Demo
          </a>

          {/* Hamburger */}
          <button
            className="nav-burger"
            onClick={() => setMobileOpen(!mobileOpen)}
            aria-label="القائمة"
          >
            {mobileOpen
              ? <svg width="22" height="22" fill="none" stroke="var(--navy)" strokeWidth="2.2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12"/></svg>
              : <svg width="22" height="22" fill="none" stroke="var(--navy)" strokeWidth="2.2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16"/></svg>
            }
          </button>
        </div>
      </div>

      {/* Mobile Menu */}
      <div className={`nav-mob${mobileOpen ? ' open' : ''}`} dir="rtl">
        {NAV.map((item) => (
          <a
            key={item.href}
            href={item.href}
            onClick={() => setMobileOpen(false)}
            style={{ padding: '12px 14px', borderRadius: 10, fontSize: 15, fontWeight: 700, color: 'var(--navy)', textDecoration: 'none', background: 'transparent', display: 'block' }}
          >
            {item.label}
          </a>
        ))}
        <Link href="/dashboard" onClick={() => setMobileOpen(false)} style={{ marginTop: 8, padding: '12px 14px', borderRadius: 10, fontSize: 14, fontWeight: 800, color: 'var(--navy)', textDecoration: 'none', border: '2px solid #E2E8F0', display: 'block', textAlign: 'center' }}>
          تسجيل الدخول
        </Link>
      </div>
    </nav>
  )
}
