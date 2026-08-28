export default function Footer({ phone, email }: { phone: string; email: string }) {
  return (
    <footer className="g-navy" style={{ color: '#fff', padding: '70px 0 30px' }} dir="rtl">
      <div className="px-page" style={{ maxWidth: 1280, margin: '0 auto' }}>

        <div className="rg-foot" style={{ marginBottom: 50 }}>

          {/* Brand */}
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
              <div className="g-gold" style={{ width: 42, height: 42, borderRadius: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 4px 14px rgba(200,168,75,.35)' }}>
                <svg width="22" height="22" fill="none" stroke="white" strokeWidth="1.8" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M3 21h18M3 10h18M3 7l9-4 9 4M4 10v11M20 10v11M8 10v11M16 10v11M12 7v14"/></svg>
              </div>
              <div>
                <div style={{ fontSize: 20, fontWeight: 900, letterSpacing: '.5px' }}>دُسْتُورِي</div>
                <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: 3, color: 'rgba(255,255,255,.3)', textTransform: 'uppercase' }}>DOSTOORI LEGAL</div>
              </div>
            </div>
            <p style={{ fontSize: 14, color: 'rgba(255,255,255,.45)', lineHeight: 1.9, fontWeight: 500, maxWidth: 340 }}>
              نظام سحابي متكامل لإدارة مكاتب وشركات المحاماة الأردنية — مصمم خصيصاً لمتطلبات القانون والسوق الأردني.
            </p>
            <div style={{ marginTop: 20, fontSize: 13, color: 'rgba(255,255,255,.4)', fontWeight: 500, lineHeight: 2 }}>
              <div>📞 خدمة عملاء الأردن: {phone}</div>
              <div>✉️ {email}</div>
            </div>
          </div>

          {/* Platform links */}
          <div>
            <h4 style={{ fontSize: 11, fontWeight: 900, color: 'rgba(255,255,255,.3)', textTransform: 'uppercase', letterSpacing: 3, marginBottom: 20 }}>المنصة</h4>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12, fontSize: 14 }}>
              {['قاعدة التشريعات', 'البحث الذكي', 'توليد الوثائق', 'نظام ERP', 'تكامل المحاكم'].map((l) => (
                <a key={l} href="#features" style={{ color: 'rgba(255,255,255,.55)', textDecoration: 'none', fontWeight: 600 }}>{l}</a>
              ))}
            </div>
          </div>

          {/* Company links */}
          <div>
            <h4 style={{ fontSize: 11, fontWeight: 900, color: 'rgba(255,255,255,.3)', textTransform: 'uppercase', letterSpacing: 3, marginBottom: 20 }}>الشركة</h4>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12, fontSize: 14 }}>
              {[
                { label: 'عن دُسْتُورِي', href: '#' },
                { label: 'عملاؤنا', href: '#clients' },
                { label: 'الأسئلة الشائعة', href: '#faq' },
                { label: 'تواصل معنا', href: '#trial' },
                { label: 'المدونة القانونية', href: '#' },
              ].map(({ label, href }) => (
                <a key={label} href={href} style={{ color: 'rgba(255,255,255,.55)', textDecoration: 'none', fontWeight: 600 }}>{label}</a>
              ))}
            </div>
          </div>

        </div>

        <div style={{ height: 1, background: 'linear-gradient(90deg,transparent,rgba(200,168,75,.25),transparent)', marginBottom: 28 }} />

        <div className="foot-bottom-bar" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 12, color: 'rgba(255,255,255,.22)', fontWeight: 500 }}>
          <div style={{ display: 'flex', gap: 24 }}>
            <a href="/privacy" style={{ color: 'inherit', textDecoration: 'none' }}>سياسة الخصوصية</a>
            <a href="/terms" style={{ color: 'inherit', textDecoration: 'none' }}>شروط الاستخدام</a>
          </div>
          <span>© 2026 دُسْتُورِي · عمّان، المملكة الأردنية الهاشمية 🇯🇴</span>
        </div>

      </div>
    </footer>
  )
}
