const CheckIcon = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="20 6 9 17 4 12" />
  </svg>
)

const plans = [
  {
    id: 'basic',
    label: 'الباقة الأساسية',
    tagline: 'كل ما تحتاجه لإدارة مكتبك بالكامل',
    icon: '⚖️',
    dark: false,
    popular: false,
    features: [
      'إدارة القضايا والملفات بالكامل',
      'تذكيرات الجلسات التلقائية',
      'توليد المستندات بالذكاء الاصطناعي',
      'إدارة الأتعاب والفواتير',
      'بوابة الموكّل الإلكترونية',
      'تقارير وتحليلات المكتب',
      'تشفير البيانات ونسخ احتياطي يومي',
    ],
  },
  {
    id: 'automation',
    label: 'باقة الأتمتة',
    tagline: 'تواصل ذكي مع موكليك على كل المنصات',
    icon: '🤖',
    dark: true,
    popular: true,
    features: [
      'كل مزايا الباقة الأساسية',
      'أتمتة واتساب — ردود وجدولة مواعيد',
      'أتمتة انستغرام — ردود ورسائل تلقائية',
      'أتمتة فيسبوك — استقبال الاستفسارات آلياً',
      'ربط كامل بين المنصات وملف الموكّل',
      'تقارير تفاعل المنصات الاجتماعية',
    ],
  },
  {
    id: 'web',
    label: 'باقة الموقع والدومين',
    tagline: 'حضور رقمي احترافي كامل لمكتبك',
    icon: '🌐',
    dark: false,
    popular: false,
    features: [
      'كل مزايا باقة الأتمتة',
      'موقع ويب احترافي لمكتبك',
      'دومين أساسي مسجّل باسمك',
      'استضافة سحابية وصيانة دورية',
      'تصميم مخصص يعكس هوية مكتبك',
      'تحسين ظهور المكتب في نتائج البحث',
    ],
  },
]

const WaIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
    <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z"/>
    <path d="M12 0C5.373 0 0 5.373 0 12c0 2.117.554 4.103 1.523 5.824L0 24l6.388-1.501A11.955 11.955 0 0012 24c6.627 0 12-5.373 12-12S18.627 0 12 0zm0 21.818a9.8 9.8 0 01-5.032-1.388l-.36-.214-3.733.878.935-3.618-.235-.372A9.772 9.772 0 012.182 12C2.182 6.57 6.57 2.182 12 2.182S21.818 6.57 21.818 12 17.43 21.818 12 21.818z"/>
  </svg>
)

export default function Packages() {
  return (
    <section id="packages" style={{ padding: '90px 0', background: '#F8F5EF' }}>
      <div className="px-page" style={{ maxWidth: 1280, margin: '0 auto' }}>

        {/* Header */}
        <div className="rv" style={{ textAlign: 'center', marginBottom: 56 }}>
          <span className="g-navy" style={{ color: '#fff', fontSize: 11, fontWeight: 900, padding: '7px 20px', borderRadius: 100, display: 'inline-block', marginBottom: 16, letterSpacing: 2 }}>الباقات</span>
          <h2 style={{ fontSize: 36, fontWeight: 900, color: 'var(--navy)', marginBottom: 12, lineHeight: 1.35 }}>
            اختر الباقة <span className="t-gold">المناسبة لمكتبك</span>
          </h2>
          <p style={{ fontSize: 15, color: '#64748B', maxWidth: 500, margin: '0 auto', lineHeight: 1.8 }}>
            ثلاث باقات متكاملة تبدأ من إدارة المكتب وصولاً إلى حضور رقمي شامل
          </p>
        </div>

        {/* Cards */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 24, maxWidth: 1060, margin: '0 auto' }}
          className="packages-grid">
          {plans.map((plan) => (
            <div
              key={plan.id}
              className="rv"
              style={{
                position: 'relative',
                background: plan.dark ? 'linear-gradient(155deg,#0F172A 0%,#1E3A8A 100%)' : '#fff',
                borderRadius: 22,
                padding: '36px 30px 32px',
                border: plan.dark ? '1.5px solid rgba(212,175,55,.3)' : '1.5px solid rgba(15,23,42,.07)',
                boxShadow: plan.dark
                  ? '0 12px 48px rgba(15,23,42,.25)'
                  : '0 4px 24px rgba(0,0,0,.06)',
                display: 'flex',
                flexDirection: 'column',
                gap: 0,
              }}
              dir="rtl"
            >
              {/* Popular badge */}
              {plan.popular && (
                <div style={{
                  position: 'absolute', top: -14, right: 28,
                  background: 'linear-gradient(135deg,#D4AF37,#C5A059)',
                  color: '#0F172A', fontSize: 11, fontWeight: 900,
                  padding: '5px 16px', borderRadius: 100, letterSpacing: 1,
                }}>
                  الأكثر طلباً
                </div>
              )}

              {/* Icon */}
              <div style={{
                width: 54, height: 54, borderRadius: 15,
                background: plan.dark ? 'rgba(212,175,55,.15)' : 'rgba(15,23,42,.06)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: '1.6rem', marginBottom: 20,
              }}>
                {plan.icon}
              </div>

              {/* Title & tagline */}
              <div style={{ fontSize: 19, fontWeight: 900, color: plan.dark ? '#fff' : 'var(--navy)', marginBottom: 6 }}>
                {plan.label}
              </div>
              <div style={{ fontSize: 13, color: plan.dark ? 'rgba(255,255,255,.5)' : '#64748B', lineHeight: 1.7, marginBottom: 26 }}>
                {plan.tagline}
              </div>

              {/* Divider */}
              <div style={{ height: 1, background: plan.dark ? 'rgba(255,255,255,.08)' : '#F1F5F9', marginBottom: 24 }} />

              {/* Features */}
              <ul style={{ listStyle: 'none', padding: 0, margin: '0 0 auto', display: 'flex', flexDirection: 'column', gap: 13 }}>
                {plan.features.map((f, i) => (
                  <li key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, fontSize: 13, fontWeight: 600, color: plan.dark ? 'rgba(255,255,255,.75)' : '#334155' }}>
                    <span style={{
                      flexShrink: 0, width: 22, height: 22, borderRadius: '50%',
                      background: plan.dark ? 'rgba(212,175,55,.2)' : 'rgba(22,163,74,.1)',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      color: plan.dark ? '#D4AF37' : '#15803D', marginTop: 1,
                    }}>
                      <CheckIcon />
                    </span>
                    {f}
                  </li>
                ))}
              </ul>

              {/* CTA */}
              <a
                href="#trial"
                style={{
                  marginTop: 30,
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                  fontSize: 13, fontWeight: 900,
                  padding: '12px 20px', borderRadius: 11,
                  textDecoration: 'none',
                  ...(plan.dark
                    ? { background: 'linear-gradient(135deg,#D4AF37,#C5A059)', color: '#0F172A' }
                    : { background: 'var(--navy)', color: '#fff' }),
                }}
              >
                <WaIcon />
                استفسر عن الباقة
              </a>
            </div>
          ))}
        </div>

      </div>

      <style>{`
        @media (max-width: 900px) {
          .packages-grid { grid-template-columns: 1fr 1fr !important; }
        }
        @media (max-width: 640px) {
          .packages-grid { grid-template-columns: 1fr !important; max-width: 440px !important; }
        }
      `}</style>
    </section>
  )
}
