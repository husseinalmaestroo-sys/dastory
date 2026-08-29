'use client'

import { useEffect, useRef, useState } from 'react'

function toAr(n: number) {
  return String(Math.floor(n)).replace(/\d/g, d => '٠١٢٣٤٥٦٧٨٩'[Number(d)])
}

function LogoSVG({ style }: { style?: React.CSSProperties }) {
  return (
    <svg style={style} viewBox="0 0 72 72" fill="none">
      <rect width="72" height="72" rx="15" fill="#0F172A" />
      <rect x="1" y="1" width="70" height="70" rx="14" stroke="#C8A84B" strokeWidth="1.5" strokeOpacity=".45" />
      <line x1="36" y1="11" x2="36" y2="61" stroke="#C8A84B" strokeWidth="2.8" strokeLinecap="round" />
      <line x1="15" y1="22" x2="57" y2="22" stroke="#C8A84B" strokeWidth="2.8" strokeLinecap="round" />
      <circle cx="15" cy="32" r="8.5" fill="none" stroke="#C8A84B" strokeWidth="2.5" />
      <circle cx="57" cy="32" r="8.5" fill="none" stroke="#C8A84B" strokeWidth="2.5" />
      <line x1="25" y1="61" x2="47" y2="61" stroke="#C8A84B" strokeWidth="2.8" strokeLinecap="round" />
    </svg>
  )
}

function TypingDots() {
  return (
    <>
      <style>{`@keyframes tb{0%,60%,100%{transform:translateY(0);opacity:.5}30%{transform:translateY(-7px);opacity:1}}`}</style>
      <div style={{ display: 'flex', gap: 5, padding: '9px 13px', background: 'rgba(255,255,255,.06)', border: '1px solid rgba(255,255,255,.12)', borderRadius: 12, width: 'fit-content', alignSelf: 'flex-start' }}>
        {[0, 1, 2].map(i => (
          <div key={i} style={{ width: 5, height: 5, background: '#C8A84B', borderRadius: '50%', animation: `tb 1.4s ease-in-out ${i * 0.2}s infinite` }} />
        ))}
      </div>
    </>
  )
}

export default function HeroIntroAnimation() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [scene, setScene] = useState(0)
  const [s1, setS1] = useState(0)
  const [s2, setS2] = useState(0)
  const [s3, setS3] = useState(0)

  // Particle canvas
  useEffect(() => {
    const cv = canvasRef.current
    if (!cv) return
    const ctx = cv.getContext('2d')!

    const pts = Array.from({ length: 50 }, () => ({
      x: Math.random() * 800, y: Math.random() * 500,
      vx: (Math.random() - .5) * .22, vy: (Math.random() - .5) * .22,
      r: Math.random() * 1.4 + .3,
      op: Math.random() * .45 + .15,
      pa: Math.random() * Math.PI * 2,
    }))

    function resize() {
      if (!cv) return
      cv.width = cv.offsetWidth
      cv.height = cv.offsetHeight
    }
    resize()
    window.addEventListener('resize', resize)

    let raf: number
    function draw() {
      if (!ctx || !cv) return
      ctx.clearRect(0, 0, cv.width, cv.height)

      ctx.lineWidth = .5
      ctx.strokeStyle = 'rgba(200,168,75,.045)'
      for (let x = 0; x < cv.width; x += 60) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, cv.height); ctx.stroke() }
      for (let y = 0; y < cv.height; y += 60) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(cv.width, y); ctx.stroke() }
      ctx.strokeStyle = 'rgba(200,168,75,.025)'
      for (let i = -cv.height; i < cv.width + cv.height; i += 90) {
        ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i + cv.height, cv.height); ctx.stroke()
      }

      pts.forEach(p => {
        p.x += p.vx; p.y += p.vy; p.pa += .018
        if (p.x < 0) p.x = cv.width; if (p.x > cv.width) p.x = 0
        if (p.y < 0) p.y = cv.height; if (p.y > cv.height) p.y = 0
        ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2)
        ctx.fillStyle = `rgba(200,168,75,${p.op * (.7 + Math.sin(p.pa) * .3)})`; ctx.fill()
      })

      for (let i = 0; i < pts.length; i++) {
        for (let j = i + 1; j < pts.length; j++) {
          const dx = pts[i].x - pts[j].x, dy = pts[i].y - pts[j].y
          const d = Math.sqrt(dx * dx + dy * dy)
          if (d < 90) {
            ctx.beginPath(); ctx.moveTo(pts[i].x, pts[i].y); ctx.lineTo(pts[j].x, pts[j].y)
            ctx.strokeStyle = `rgba(200,168,75,${.07 * (1 - d / 90)})`; ctx.lineWidth = .5; ctx.stroke()
          }
        }
      }
      raf = requestAnimationFrame(draw)
    }
    draw()
    return () => { cancelAnimationFrame(raf); window.removeEventListener('resize', resize) }
  }, [])

  // Scene rotation
  useEffect(() => {
    const t = setInterval(() => setScene(s => (s + 1) % 5), 4600)
    return () => clearInterval(t)
  }, [])

  // Reset the counters the moment scene 3 becomes active — a guarded
  // render-phase update (React's "adjust state when a value changes"
  // pattern), not a synchronous setState in the effect below
  // (react-hooks/set-state-in-effect).
  const [countedScene, setCountedScene] = useState(scene)
  if (scene !== countedScene) {
    setCountedScene(scene)
    if (scene === 3) { setS1(0); setS2(0); setS3(0) }
  }

  // Stats counter on scene 3
  useEffect(() => {
    if (scene !== 3) return
    const t = setInterval(() => {
      setS1(v => Math.min(v + 10, 500))
      setS2(v => Math.min(v + 240, 12000))
      setS3(v => Math.min(v + 2, 99))
    }, 36)
    return () => clearInterval(t)
  }, [scene])

  const sc = (n: number): React.CSSProperties => ({
    position: 'absolute', inset: 0,
    display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
    padding: '6% 8%',
    opacity: scene === n ? 1 : 0,
    transition: 'opacity .9s cubic-bezier(.4,0,.2,1)',
    pointerEvents: scene === n ? 'auto' : 'none',
    zIndex: 2,
  })

  const iconBox: React.CSSProperties = {
    width: 56, height: 56,
    background: 'rgba(200,168,75,.15)',
    border: '1.5px solid rgba(200,168,75,.3)',
    borderRadius: 16,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    marginBottom: 14,
  }
  const title = (children: React.ReactNode) => (
    <div style={{ fontSize: 'clamp(18px,3.5vw,32px)', fontWeight: 900, color: '#fff', textAlign: 'center', marginBottom: 10, lineHeight: 1.35 }}>{children}</div>
  )
  const desc = (text: string) => (
    <div style={{ fontSize: 'clamp(11px,1.5vw,14px)', color: 'rgba(255,255,255,.7)', textAlign: 'center', lineHeight: 1.8, maxWidth: 380, fontWeight: 400 }}>{text}</div>
  )

  return (
    <div style={{ width: '100%', height: '100%', position: 'relative', overflow: 'hidden', background: '#070E1C', direction: 'rtl', fontFamily: "'Segoe UI',system-ui,Tahoma,Arial,sans-serif" }}>

      {/* Glows */}
      <div style={{ position: 'absolute', width: '55%', height: '70%', top: '-20%', right: '-10%', background: 'radial-gradient(ellipse,rgba(200,168,75,.09),transparent 65%)', pointerEvents: 'none', borderRadius: '50%' }} />
      <div style={{ position: 'absolute', width: '45%', height: '60%', bottom: '-20%', left: '-5%', background: 'radial-gradient(ellipse,rgba(59,130,246,.06),transparent 65%)', pointerEvents: 'none', borderRadius: '50%' }} />

      <canvas ref={canvasRef} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', opacity: .4 }} />

      {/* S1: Brand */}
      <div style={sc(0)}>
        <LogoSVG style={{ width: 72, height: 72, marginBottom: 20, filter: 'drop-shadow(0 0 28px rgba(200,168,75,.45))' }} />
        <div style={{ fontSize: 'clamp(32px,5vw,52px)', fontWeight: 900, color: '#C8A84B', letterSpacing: '.03em', textShadow: '0 0 50px rgba(200,168,75,.45)', marginBottom: 10 }}>دُسْتُورِي</div>
        <div style={{ fontSize: 'clamp(12px,1.8vw,16px)', color: 'rgba(255,255,255,.7)', fontWeight: 500, letterSpacing: '.05em' }}>المنصة القانونية السحابية الأولى في الأردن</div>
      </div>

      {/* S2: Cases */}
      <div style={sc(1)}>
        <div style={iconBox}>
          <svg width="24" height="24" fill="none" stroke="#C8A84B" strokeWidth="2" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2M9 12h6M9 16h4" />
          </svg>
        </div>
        {title(<>إدارة <span style={{ color: '#E2C97E' }}>القضايا والجلسات</span></>)}
        {desc('تتبّع كل قضية بدقة — الجلسات، المواعيد، الأطراف، والمستجدات من مكان واحد')}
        <div style={{ background: 'rgba(255,255,255,.05)', border: '1px solid rgba(200,168,75,.12)', borderRadius: 12, padding: '12px 16px', width: '100%', maxWidth: 370, marginTop: 14 }}>
          {[
            { dot: '#22C55E', text: 'القضية ٢٠٢٥/١١٢ — جلسة غداً', badge: 'نشطة' },
            { dot: '#F59E0B', text: 'القضية ٢٠٢٤/٣٤٧ — بانتظار الحكم', badge: 'قيد النظر' },
            { dot: '#60A5FA', text: 'القضية ٢٠٢٥/٠٨٩ — رُفعت اليوم', badge: 'جديدة' },
          ].map((r, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '7px 0', borderBottom: i < 2 ? '1px solid rgba(255,255,255,.04)' : 'none', fontSize: 'clamp(10px,1.4vw,13px)', color: 'rgba(255,255,255,.7)' }}>
              <div style={{ width: 7, height: 7, borderRadius: '50%', background: r.dot, flexShrink: 0 }} />
              {r.text}
              <div style={{ marginRight: 'auto', fontSize: 10, padding: '2px 8px', borderRadius: 20, background: 'rgba(200,168,75,.14)', color: '#E2C97E', fontWeight: 700, flexShrink: 0 }}>{r.badge}</div>
            </div>
          ))}
        </div>
      </div>

      {/* S3: AI */}
      <div style={sc(2)}>
        <div style={iconBox}>
          <svg width="24" height="24" fill="none" stroke="#C8A84B" strokeWidth="2" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
          </svg>
        </div>
        {title(<>محرك <span style={{ color: '#E2C97E' }}>الذكاء الاصطناعي</span> القانوني</>)}
        {desc('ابحث في التشريعات، حلّل المستندات، واحصل على الإجابة القانونية فوراً')}
        <div style={{ width: '100%', maxWidth: 370, marginTop: 14, display: 'flex', flexDirection: 'column', gap: 7 }}>
          <div style={{ padding: '9px 13px', borderRadius: 12, fontSize: 'clamp(10px,1.4vw,12.5px)', lineHeight: 1.65, maxWidth: '82%', background: 'rgba(200,168,75,.14)', border: '1px solid rgba(200,168,75,.22)', color: 'rgba(255,255,255,.7)', alignSelf: 'flex-end', textAlign: 'right' }}>ما هي مدة التقادم في قضايا الملكية العقارية؟</div>
          <div style={{ padding: '9px 13px', borderRadius: 12, fontSize: 'clamp(10px,1.4vw,12.5px)', lineHeight: 1.65, maxWidth: '82%', background: 'rgba(255,255,255,.06)', border: '1px solid rgba(255,255,255,.12)', color: '#fff', alignSelf: 'flex-start', textAlign: 'right' }}>يتوقف على نوع العقار: المسجل في دائرة الأراضي لا يسري عليه التقادم مطلقاً. أما غير المسجل فـ١٠ سنوات للأراضي الأميرية و١٥ للملك (م. ٤٤٩ مدني)…</div>
          <TypingDots />
        </div>
      </div>

      {/* S4: Stats */}
      <div style={sc(3)}>
        {title(<>كل ما يحتاجه <span style={{ color: '#E2C97E' }}>مكتبك القانوني</span></>)}
        {desc('الموكلون، المستندات، المالية، والتقارير — كل شيء في منصة واحدة سحابية')}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 12, width: '100%', maxWidth: 460, marginTop: 18 }}>
          {[
            { num: toAr(s1) + '+', lbl: 'مكتب محاماة' },
            { num: toAr(s2) + '+', lbl: 'قضية مُدارة' },
            { num: toAr(s3) + '%', lbl: 'نسبة رضا المستخدمين' },
          ].map((s, i) => (
            <div key={i} style={{ background: 'rgba(255,255,255,.05)', border: '1px solid rgba(200,168,75,.12)', borderRadius: 12, padding: '14px 10px', textAlign: 'center' }}>
              <span style={{ display: 'block', fontSize: 'clamp(20px,3.5vw,28px)', fontWeight: 900, color: '#E2C97E', fontVariantNumeric: 'tabular-nums' }}>{s.num}</span>
              <span style={{ display: 'block', fontSize: 10, color: 'rgba(255,255,255,.4)', fontWeight: 500, marginTop: 4, lineHeight: 1.4 }}>{s.lbl}</span>
            </div>
          ))}
        </div>
      </div>

      {/* S5: CTA */}
      <div style={sc(4)}>
        <LogoSVG style={{ width: 52, height: 52, marginBottom: 16, filter: 'drop-shadow(0 0 18px rgba(200,168,75,.4))' }} />
        <div style={{ fontSize: 'clamp(18px,3vw,28px)', fontWeight: 900, color: '#fff', textAlign: 'center', lineHeight: 1.45, marginBottom: 10 }}>
          ابدأ تجربتك المجانية مع <span style={{ color: '#E2C97E' }}>دُسْتُورِي</span> اليوم
        </div>
        {desc('نظام سحابي متكامل · مصمم للمحامين الأردنيين · آمن وموثوق')}
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '12px 30px', background: 'linear-gradient(135deg,#C8A84B 0%,#9A7A2E 100%)', borderRadius: 50, color: '#070E1C', fontWeight: 900, fontSize: 'clamp(12px,1.8vw,15px)', marginTop: 18, boxShadow: '0 8px 28px rgba(200,168,75,.38)' }}>
          <svg width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
          ابدأ الآن مجاناً
        </div>
      </div>

      {/* Progress dots */}
      <div style={{ position: 'absolute', bottom: 14, left: '50%', transform: 'translateX(-50%)', display: 'flex', gap: 6, zIndex: 10 }}>
        {[0, 1, 2, 3, 4].map(i => (
          <div key={i} style={{ width: scene === i ? 22 : 6, height: 6, borderRadius: scene === i ? 3 : '50%', background: scene === i ? '#C8A84B' : 'rgba(255,255,255,.22)', transition: 'all .4s ease' }} />
        ))}
      </div>
    </div>
  )
}
