const WaIcon = ({ fill = 'white' }: { fill?: string }) => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill={fill}>
    <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z"/>
    <path d="M12 0C5.373 0 0 5.373 0 12c0 2.117.554 4.103 1.523 5.824L0 24l6.388-1.501A11.955 11.955 0 0012 24c6.627 0 12-5.373 12-12S18.627 0 12 0zm0 21.818a9.8 9.8 0 01-5.032-1.388l-.36-.214-3.733.878.935-3.618-.235-.372A9.772 9.772 0 012.182 12C2.182 6.57 6.57 2.182 12 2.182S21.818 6.57 21.818 12 17.43 21.818 12 21.818z"/>
  </svg>
)

export default function OtherServices() {
  return (
    <section style={{ padding: '90px 0', background: '#F8F5EF' }}>
      <div className="px-page" style={{ maxWidth: 1280, margin: '0 auto' }}>
        <div className="rv" style={{ textAlign: 'center', marginBottom: 52 }}>
          <span className="g-navy" style={{ color: '#fff', fontSize: 11, fontWeight: 900, padding: '7px 20px', borderRadius: 100, display: 'inline-block', marginBottom: 16, letterSpacing: 2 }}>خدمات إضافية</span>
          <h2 style={{ fontSize: 36, fontWeight: 900, color: 'var(--navy)', marginBottom: 12 }}>
            خدمات رقمية يمكنك <span className="t-gold">طلبها الآن</span>
          </h2>
          <p style={{ fontSize: 15, color: '#64748B', maxWidth: 520, margin: '0 auto', lineHeight: 1.8 }}>
            بجانب نظام دُسْتُورِي، نقدّم حلولاً رقمية مخصصة لتطوير مكتبك القانوني
          </p>
        </div>
        <div className="rg3" style={{ maxWidth: 960, margin: '0 auto' }}>

          {/* WhatsApp Bot */}
          <div className="rv" style={{ background: '#fff', borderRadius: 18, padding: 28, border: '1px solid rgba(15,23,42,.07)', boxShadow: '0 4px 20px rgba(0,0,0,.05)', transition: 'transform .2s,box-shadow .2s' }}>
            <div style={{ width: 50, height: 50, borderRadius: 13, background: 'linear-gradient(135deg,#25D366,#128C7E)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.4rem', marginBottom: 18 }}>💬</div>
            <div style={{ fontSize: 17, fontWeight: 900, color: 'var(--navy)', marginBottom: 8 }}>WhatsApp Bot ذكي</div>
            <div style={{ fontSize: 13, color: '#64748B', lineHeight: 1.8, marginBottom: 20 }}>بوت يردّ على الموكّلين، يجدوّل مواعيدهم، ويرسل تذكيرات الجلسات تلقائياً دون تدخّل يدوي.</div>
            <a href="https://wa.me/9627900000000?text=مرحبا،+أريد+الاستفسار+عن+خدمة+WhatsApp+Bot+الذكي" target="_blank" rel="noreferrer"
              style={{ display: 'inline-flex', alignItems: 'center', gap: 7, fontSize: 13, fontWeight: 800, color: '#fff', background: 'linear-gradient(135deg,#25D366,#128C7E)', padding: '9px 18px', borderRadius: 9, textDecoration: 'none' }}>
              <WaIcon /> اطلب الخدمة
            </a>
          </div>

          {/* Google Workspace */}
          <div className="rv" style={{ background: '#fff', borderRadius: 18, padding: 28, border: '1px solid rgba(15,23,42,.07)', boxShadow: '0 4px 20px rgba(0,0,0,.05)', transition: 'transform .2s,box-shadow .2s' }}>
            <div style={{ width: 50, height: 50, borderRadius: 13, background: 'linear-gradient(135deg,#D4AF37,#C5A059)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.4rem', marginBottom: 18 }}>📧</div>
            <div style={{ fontSize: 17, fontWeight: 900, color: 'var(--navy)', marginBottom: 8 }}>بريد رسمي + Google Workspace</div>
            <div style={{ fontSize: 13, color: '#64748B', lineHeight: 1.8, marginBottom: 20 }}>إعداد بريد المكتب الرسمي (خالد@مكتبك.jo) مع تخزين سحابي وتقويم مشترك لكامل الفريق.</div>
            <a href="https://wa.me/9627900000000?text=مرحبا،+أريد+الاستفسار+عن+خدمة+البريد+الرسمي+و+Google+Workspace" target="_blank" rel="noreferrer"
              style={{ display: 'inline-flex', alignItems: 'center', gap: 7, fontSize: 13, fontWeight: 800, color: '#fff', background: 'linear-gradient(135deg,#D4AF37,#C5A059)', padding: '9px 18px', borderRadius: 9, textDecoration: 'none' }}>
              <WaIcon /> اطلب الخدمة
            </a>
          </div>

          {/* Custom */}
          <div className="rv" style={{ background: 'linear-gradient(135deg,#0F172A,#1E3A8A)', borderRadius: 18, padding: 28, border: '1px solid rgba(212,175,55,.2)', boxShadow: '0 4px 20px rgba(0,0,0,.1)', transition: 'transform .2s' }}>
            <div style={{ width: 50, height: 50, borderRadius: 13, background: 'rgba(212,175,55,.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.4rem', marginBottom: 18 }}>✨</div>
            <div style={{ fontSize: 17, fontWeight: 900, color: '#fff', marginBottom: 8 }}>خدمة مخصصة لمكتبك</div>
            <div style={{ fontSize: 13, color: 'rgba(255,255,255,.55)', lineHeight: 1.8, marginBottom: 20 }}>لديك فكرة أو احتياج خاص؟ تواصل معنا وسنبني لك الحل المناسب تماماً لطبيعة مكتبك.</div>
            <a href="https://wa.me/9627900000000?text=مرحبا،+لدي+احتياج+خاص+وأريد+الاستفسار+عن+خدمة+مخصصة+لمكتبي" target="_blank" rel="noreferrer"
              className="g-gold"
              style={{ display: 'inline-flex', alignItems: 'center', gap: 7, fontSize: 13, fontWeight: 800, color: '#0F172A', padding: '9px 18px', borderRadius: 9, textDecoration: 'none' }}>
              <WaIcon fill="#0F172A" /> تواصل معنا
            </a>
          </div>

        </div>
      </div>
    </section>
  )
}
