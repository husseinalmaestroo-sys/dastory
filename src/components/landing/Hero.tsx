'use client'

import { useEffect, useState } from 'react'
import HeroIntroAnimation from '@/components/landing/HeroIntroAnimation'

type AdminVideo = { type: string; url: string; autoplay?: boolean; loop?: boolean; controls?: boolean }

export default function Hero() {
  const [adminVideo, setAdminVideo] = useState<AdminVideo | null>(null)

  useEffect(() => {
    const vidData = localStorage.getItem('dstoori_hero_video')
    if (!vidData) return
    const v = JSON.parse(vidData) as AdminVideo
    if (v?.url) setAdminVideo(v)
  }, [])

  function renderAdminVideo(v: AdminVideo) {
    if (v.type === 'yt') {
      const m  = v.url.match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|embed\/|shorts\/))([A-Za-z0-9_-]{11})/)
      const id = m ? m[1] : ''
      const params = '?rel=0' + (v.autoplay ? '&autoplay=1&mute=1' : '') + (v.loop ? `&loop=1&playlist=${id}` : '')
      return (
        <iframe
          src={`https://www.youtube.com/embed/${id}${params}`}
          style={{ width: '100%', height: '100%', border: 'none' }}
          allowFullScreen
          allow="autoplay; fullscreen; picture-in-picture"
        />
      )
    }
    return (
      <video
        src={v.url}
        style={{ width: '100%', height: '100%', objectFit: 'cover' }}
        autoPlay={v.autoplay}
        muted={v.autoplay}
        loop={v.loop}
        controls={v.controls}
        playsInline
      />
    )
  }

  return (
    <section id="home" className="arabesque" style={{ minHeight: 600, padding: '70px 0 80px', overflow: 'hidden' }}>
      <div className="rg-hero px-page" style={{ maxWidth: 1280, margin: '0 auto' }}>

        {/* Right: copy */}
        <div style={{ textAlign: 'right', position: 'relative', zIndex: 2 }}>
          <h1 style={{ fontSize: 'clamp(40px,4.5vw,58px)', fontWeight: 900, lineHeight: 1.25, color: '#fff', marginBottom: 24, textShadow: '0 2px 20px rgba(0,0,0,.3)' }}>
            برنامج إدارة مكاتب المحاماة
            <span style={{ display: 'block', marginTop: 4 }} className="t-gold">والقضايا الأردنية</span>
          </h1>
          <p style={{ fontSize: 17, color: 'rgba(255,255,255,.65)', lineHeight: 1.85, fontWeight: 500, marginBottom: 12 }}>
            دُسْتُورِي هو نظام سحابي لإدارة مكاتب وشركات المحاماة، يساعد على تنظيم القضايا والجلسات والموكلين والمستندات والأتعاب والماليات من منصة واحدة.
          </p>
          <p style={{ fontSize: 13, color: 'rgba(255,255,255,.38)', fontWeight: 500, marginBottom: 36 }}>
            دُسْتُورِي ليس مكتب محاماة ولا يقدم الاستشارات القانونية مباشرة، بل يوفر نظاماً تقنياً لمساعدة المكاتب والشركات القانونية على إدارة أعمالها.
          </p>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
            <a href="#trial" className="g-gold" style={{ display: 'inline-flex', alignItems: 'center', gap: 10, fontSize: 15, fontWeight: 900, color: '#fff', padding: '14px 30px', borderRadius: 12, textDecoration: 'none', boxShadow: '0 6px 24px rgba(200,168,75,.45)', transition: 'transform .2s' }}>
              <svg width="18" height="18" fill="none" stroke="white" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"/></svg>
              اشترك الآن
            </a>
            <a href="#features" style={{ display: 'inline-flex', alignItems: 'center', gap: 10, fontSize: 15, fontWeight: 800, color: 'rgba(255,255,255,.85)', padding: '13px 28px', borderRadius: 12, textDecoration: 'none', border: '2px solid rgba(255,255,255,.25)', transition: 'background .2s' }}>
              <svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/></svg>
              تفاصيل نظام دُسْتُورِي
            </a>
          </div>
        </div>

        {/* Left: video */}
        <div className="hero-vid-wrap" style={{ position: 'relative', height: 460, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ width: '100%', height: '100%', borderRadius: 20, overflow: 'hidden', position: 'relative', border: '1px solid rgba(212,175,55,.2)', boxShadow: '0 24px 60px rgba(0,0,0,.4)' }}>
            {adminVideo ? renderAdminVideo(adminVideo) : <HeroIntroAnimation />}
            <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(to left,rgba(15,23,42,.25),transparent)', pointerEvents: 'none', borderRadius: 20 }} />
          </div>
          <div style={{ position: 'absolute', inset: -20, background: 'radial-gradient(ellipse at 70% 50%,rgba(212,175,55,.08),transparent 70%)', pointerEvents: 'none', zIndex: -1 }} />
        </div>

      </div>
    </section>
  )
}
