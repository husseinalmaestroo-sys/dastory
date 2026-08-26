const rows = [
  { feature: 'البحث في التشريعات',      old: 'ساعات من البحث اليدوي في الكتب',            now: 'نتائج فورية بالذكاء الاصطناعي' },
  { feature: 'إدارة القضايا والملفات',  old: 'ملفات ورقية وجداول Excel متناثرة',          now: 'نظام سحابي منظم ومتكامل' },
  { feature: 'تذكير الجلسات',           old: 'تذكير يدوي — احتمال النسيان مرتفع',         now: 'تنبيهات تلقائية فورية على الهاتف' },
  { feature: 'توليد المستندات',         old: 'صياغة يدوية تستغرق ساعات',                   now: 'توليد تلقائي دقيق في دقائق' },
  { feature: 'الأتعاب والفواتير',       old: 'حسابات يدوية معقدة وقابلة للخطأ',            now: 'لوحة مالية لحظية ودقيقة 100%' },
  { feature: 'تواصل الموكل بالمكتب',   old: 'مكالمات وواتساب غير منظمة',                  now: 'بوابة موكل احترافية ومتابعة لحظية' },
  { feature: 'أمان البيانات',           old: 'بيانات مبعثرة في أجهزة متعددة',              now: 'تشفير AES-256 مع نسخ احتياطي يومي' },
  { feature: 'تقارير أداء المكتب',      old: 'لا يوجد — تقدير وخمن',                       now: 'لوحة تحليلات تفصيلية في الوقت الحقيقي' },
]

export default function Comparison() {
  return (
    <section id="comparison" style={{ padding: '90px 0', background: '#fff' }}>
      <div className="px-page" style={{ maxWidth: 1100, margin: '0 auto' }}>

        {/* Header */}
        <div className="rv" style={{ textAlign: 'center', marginBottom: 52 }}>
          <span className="g-gold" style={{ color: '#fff', fontSize: 11, fontWeight: 900, padding: '7px 20px', borderRadius: 100, display: 'inline-block', marginBottom: 16, letterSpacing: 2 }}>لماذا دُسْتُورِي؟</span>
          <h2 style={{ fontSize: 38, fontWeight: 900, color: 'var(--navy)', marginBottom: 12, lineHeight: 1.3 }}>
            دُسْتُورِي مقابل <span className="t-gold">الطريقة التقليدية</span>
          </h2>
          <p style={{ fontSize: 15, color: '#64748B', fontWeight: 500, maxWidth: 480, margin: '0 auto', lineHeight: 1.8 }}>
            شاهد الفرق الحقيقي الذي يصنعه دُسْتُورِي في يومك القانوني
          </p>
        </div>

        {/* Table */}
        <div className="comp-table-scroll">
        <div className="rv comp-table-inner" style={{ borderRadius: 20, overflow: 'hidden', border: '1.5px solid #E8E8E8', boxShadow: '0 8px 40px rgba(0,0,0,.06)' }}>

          {/* Header Row */}
          <div style={{ display: 'grid', gridTemplateColumns: '1.8fr 1.6fr 1.6fr', background: 'var(--navy)' }} dir="rtl">
            <div style={{ padding: '18px 24px', fontSize: 13, fontWeight: 900, color: 'rgba(255,255,255,.5)', letterSpacing: 1 }}>الميزة</div>
            <div style={{ padding: '18px 24px', fontSize: 13, fontWeight: 900, color: '#C8A84B', letterSpacing: 1, borderRight: '1px solid rgba(255,255,255,.08)' }}>
              ✦ دُسْتُورِي
            </div>
            <div style={{ padding: '18px 24px', fontSize: 13, fontWeight: 900, color: 'rgba(255,255,255,.35)', letterSpacing: 1, borderRight: '1px solid rgba(255,255,255,.08)' }}>
              الطريقة التقليدية
            </div>
          </div>

          {/* Data Rows */}
          {rows.map((row, i) => (
            <div
              key={i}
              className="rv"
              style={{ display: 'grid', gridTemplateColumns: '1.8fr 1.6fr 1.6fr', background: i % 2 === 0 ? '#fff' : '#FAFAFA', borderTop: '1px solid #F1F5F9', transition: 'background .2s' }}
              dir="rtl"
            >
              {/* Feature */}
              <div style={{ padding: '16px 24px', fontSize: 14, fontWeight: 800, color: 'var(--navy)', display: 'flex', alignItems: 'center' }}>
                {row.feature}
              </div>

              {/* Dastory */}
              <div style={{ padding: '16px 24px', fontSize: 13, fontWeight: 600, color: '#15803D', display: 'flex', alignItems: 'center', gap: 8, borderRight: '1px solid #F1F5F9', background: 'rgba(22,163,74,.03)' }}>
                <span style={{ width: 20, height: 20, borderRadius: '50%', background: '#DCFCE7', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, fontSize: 11, fontWeight: 900, color: '#15803D' }}>✓</span>
                {row.now}
              </div>

              {/* Traditional */}
              <div style={{ padding: '16px 24px', fontSize: 13, fontWeight: 600, color: '#94A3B8', display: 'flex', alignItems: 'center', gap: 8, borderRight: '1px solid #F1F5F9' }}>
                <span style={{ width: 20, height: 20, borderRadius: '50%', background: '#FEE2E2', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, fontSize: 11, fontWeight: 900, color: '#DC2626' }}>✕</span>
                {row.old}
              </div>
            </div>
          ))}
        </div>
        </div>{/* /comp-table-scroll */}

        {/* Bottom strip */}
        <div className="rv comp-strip" style={{ marginTop: 32, background: 'linear-gradient(135deg,#0F172A,#1E3A8A)', borderRadius: 18, padding: '28px 36px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 20 }} dir="rtl">
          <div>
            <div style={{ fontSize: 17, fontWeight: 900, color: '#fff', marginBottom: 6 }}>جرّب الفرق بنفسك — مجاناً لمدة 7 أيام</div>
            <div style={{ fontSize: 13, color: 'rgba(255,255,255,.45)', fontWeight: 500 }}>بدون بطاقة ائتمان · تفعيل فوري · دعم كامل من فريقنا طوال الـ 7 أيام</div>
          </div>
          <a
            href="#trial"
            className="g-gold"
            style={{ flexShrink: 0, display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 14, fontWeight: 900, color: '#0F172A', padding: '13px 28px', borderRadius: 12, textDecoration: 'none', whiteSpace: 'nowrap', boxShadow: '0 4px 16px rgba(200,168,75,.4)' }}
          >
            ابدأ الآن مجاناً ←
          </a>
        </div>

      </div>
    </section>
  )
}
