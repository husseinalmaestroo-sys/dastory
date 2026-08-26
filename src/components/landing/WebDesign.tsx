const items = [
  { emoji: '🎨', title: 'تصميم احترافي RTL', desc: 'واجهة عربية كاملة مصممة خصيصاً للمحامين والمكاتب القانونية الأردنية.' },
  { emoji: '📬', title: 'نموذج تواصل ذكي', desc: 'الزوار يملؤون استفساراتهم مباشرة وتصلك عبر WhatsApp أو البريد فوراً.' },
  { emoji: '🔗', title: 'متصل بدُسْتُورِي', desc: 'العملاء الجدد من الموقع يدخلون مباشرة إلى نظام إدارة مكتبك.' },
]

export default function WebDesign() {
  return (
    <section className="arabesque" style={{ padding: '90px 0', overflow: 'hidden' }}>
      <div className="px-page" style={{ maxWidth: 1280, margin: '0 auto' }}>
        <div className="rg-off" style={{ gap: 'clamp(32px,5vw,70px)' }}>

          {/* Right: copy */}
          <div className="rv" style={{ textAlign: 'right' }}>
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, background: 'rgba(212,175,55,.1)', border: '1px solid rgba(212,175,55,.2)', borderRadius: 100, padding: '7px 18px', marginBottom: 20 }}>
              <span style={{ width: 6, height: 6, background: '#4ADE80', borderRadius: '50%', boxShadow: '0 0 8px rgba(74,222,128,.5)' }} />
              <span style={{ fontSize: 11, fontWeight: 900, color: 'rgba(255,255,255,.7)', letterSpacing: 2 }}>خدمة إضافية</span>
            </div>
            <h2 style={{ fontSize: 'clamp(28px,3vw,42px)', fontWeight: 900, color: '#fff', lineHeight: 1.35, marginBottom: 16 }}>
              نصمّم لمكتبك موقعاً <span className="t-gold">يليق بسمعته</span>
            </h2>
            <p style={{ fontSize: 15, color: 'rgba(255,255,255,.5)', lineHeight: 1.9, marginBottom: 30 }}>
              موقع احترافي باللغة العربية، سريع، آمن، متجاوب مع الجوال — يعكس هوية مكتبك ويجذب الموكّلين الجدد. مدمج مع نظام دُسْتُورِي.
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14, marginBottom: 32 }}>
              {items.map((item) => (
                <div key={item.title} style={{ display: 'flex', alignItems: 'flex-start', gap: 12, justifyContent: 'flex-end' }}>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: 14, fontWeight: 800, color: '#fff', marginBottom: 3 }}>{item.title}</div>
                    <div style={{ fontSize: 13, color: 'rgba(255,255,255,.45)', lineHeight: 1.7 }}>{item.desc}</div>
                  </div>
                  <div style={{ width: 36, height: 36, borderRadius: 9, background: 'rgba(212,175,55,.12)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, fontSize: '1rem' }}>{item.emoji}</div>
                </div>
              ))}
            </div>
            <a href="#trial" className="g-gold" style={{ display: 'inline-flex', alignItems: 'center', gap: 10, fontSize: 14, fontWeight: 800, color: '#0F172A', padding: '13px 28px', borderRadius: 11, textDecoration: 'none', transition: 'transform .2s' }}>
              <svg width="17" height="17" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"/></svg>
              اطلب موقعك الآن
            </a>
          </div>

          {/* Left: browser mockup */}
          <div className="rv" style={{ position: 'relative' }}>
            <div style={{ background: '#1E293B', borderRadius: 14, border: '1px solid rgba(255,255,255,.08)', overflow: 'hidden', boxShadow: '0 30px 80px rgba(0,0,0,.5)' }}>
              <div style={{ background: '#334155', padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 8 }}>
                <div style={{ display: 'flex', gap: 5 }}>
                  {['#EF4444','#F59E0B','#10B981'].map((c) => <div key={c} style={{ width: 10, height: 10, borderRadius: '50%', background: c }} />)}
                </div>
                <div style={{ flex: 1, background: '#0F172A', borderRadius: 6, padding: '5px 12px', fontSize: 11, color: '#64748B', textAlign: 'center' }}>shobaki-law.jo</div>
              </div>
              <div style={{ padding: 20, background: '#0F172A' }}>
                <div style={{ background: 'linear-gradient(135deg,#1E3A8A,#0F172A)', borderRadius: 10, padding: 20, marginBottom: 14, textAlign: 'right' }}>
                  <div style={{ fontSize: 10, color: 'rgba(255,255,255,.4)', marginBottom: 6 }}>مكتب الشوبكي للمحاماة</div>
                  <div style={{ fontSize: 16, fontWeight: 900, color: '#fff', marginBottom: 4 }}>خبرة قانونية<br/><span style={{ color: '#D4AF37' }}>تُبنى على الثقة</span></div>
                  <div style={{ fontSize: 9, color: 'rgba(255,255,255,.4)', marginBottom: 12 }}>عمّان — الأردن · منذ 2008</div>
                  <div style={{ display: 'inline-block', background: '#D4AF37', borderRadius: 6, padding: '5px 14px', fontSize: 10, fontWeight: 800, color: '#0F172A' }}>تواصل معنا</div>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 8 }}>
                  {[{ e: '⚖️', l: 'قضايا مدنية' }, { e: '🏢', l: 'قضايا تجارية' }, { e: '👨‍👩‍👧', l: 'أحوال شخصية' }].map((s) => (
                    <div key={s.l} style={{ background: '#1E293B', borderRadius: 8, padding: 10, textAlign: 'center', fontSize: 9, color: 'rgba(255,255,255,.5)' }}>
                      <div style={{ fontSize: '1.2rem', marginBottom: 4 }}>{s.e}</div>{s.l}
                    </div>
                  ))}
                </div>
              </div>
            </div>
            <div style={{ position: 'absolute', bottom: -14, left: 30, background: 'linear-gradient(135deg,#D4AF37,#C5A059)', borderRadius: 12, padding: '10px 18px', fontSize: 12, fontWeight: 900, color: '#0F172A', boxShadow: '0 8px 24px rgba(212,175,55,.4)' }}>
              ✓ مسلّم خلال 7 أيام عمل
            </div>
          </div>

        </div>
      </div>
    </section>
  )
}
