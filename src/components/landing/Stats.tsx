'use client'

import { useEffect, useRef } from 'react'

interface StatItem {
  target: number
  suffix?: string
  label: string
}

const STATS: StatItem[] = [
  { target: 10000, suffix: '+', label: 'تشريع أردني في القاعدة' },
  { target: 6,                  label: 'وحدات إدارة متكاملة' },
  { target: 70,   suffix: '%',  label: 'توفير في وقت إدارة القضايا' },
  { target: 24,   suffix: '/7', label: 'دعم فني على مدار الساعة' },
]

export default function Stats() {
  const sectionRef = useRef<HTMLElement>(null)

  useEffect(() => {
    const els = document.querySelectorAll<HTMLElement>('[data-target]')
    const obs = new IntersectionObserver((entries) => {
      entries.forEach((e) => {
        if (!e.isIntersecting) return
        const el     = e.target as HTMLElement
        const target = parseInt(el.dataset.target ?? '0')
        const suffix = el.dataset.suffix ?? ''
        const dur = 1800, steps = 55
        let cur = 0
        const inc = target / steps
        const t = setInterval(() => {
          cur = Math.min(cur + inc, target)
          const v = Math.round(cur)
          el.textContent = target >= 1000 ? `${(v / 1000).toFixed(0)},000${suffix}` : `${v}${suffix}`
          if (cur >= target) clearInterval(t)
        }, dur / steps)
        obs.unobserve(el)
      })
    }, { threshold: 0.4 })
    els.forEach((el) => obs.observe(el))
    return () => obs.disconnect()
  }, [])

  return (
    <section ref={sectionRef} style={{ padding: '60px 0', background: '#fff' }} id="stats">
      <div className="px-page" style={{ maxWidth: 1100, margin: '0 auto' }}>
        <div className="rg4" style={{ textAlign: 'center' }}>
          {STATS.map((s) => (
            <div key={s.label} className="scard rv" style={{ border: '1.5px solid #E8E8E8', borderRadius: 18, padding: '28px 16px', cursor: 'default' }}>
              <div
                style={{ fontSize: 38, fontWeight: 900, color: 'var(--navy)', fontVariantNumeric: 'tabular-nums' }}
                data-target={s.target}
                data-suffix={s.suffix}
              >
                0
              </div>
              <div style={{ width: 30, height: 2, margin: '10px auto', background: 'linear-gradient(135deg,#D4AF37,#C5A059)', borderRadius: 2 }} />
              <div style={{ fontSize: 13, fontWeight: 700, color: '#64748B' }}>{s.label}</div>
            </div>
          ))}
        </div>
      </div>
      <div className="div-gold" style={{ marginTop: 60 }} />
    </section>
  )
}
