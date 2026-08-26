const features = [
  {
    title: 'إدارة الفريق القانوني',
    desc: 'صلاحيات مخصصة لكل محامٍ وموظف، تتبع الحضور والمهام والأداء.',
    iconBg: 'transparent',
    icon: (
      <div className="g-navy" style={{ width: 40, height: 40, borderRadius: 11, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
        <svg width="20" height="20" fill="none" stroke="white" strokeWidth="1.8" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z"/></svg>
      </div>
    ),
  },
  {
    title: 'لوحة الأداء والتحليلات',
    desc: 'إيرادات ومصروفات وأرباح حسب المحامي والقضية والفترة الزمنية.',
    iconBg: 'transparent',
    icon: (
      <div className="g-gold" style={{ width: 40, height: 40, borderRadius: 11, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
        <svg width="20" height="20" fill="none" stroke="white" strokeWidth="1.8" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"/></svg>
      </div>
    ),
  },
  {
    title: 'إدارة CRM للموكلين',
    desc: 'ملف شامل لكل موكل: تاريخ القضايا، الاتصالات، الفواتير، والوثائق.',
    iconBg: '#EFF6FF',
    icon: (
      <div style={{ width: 40, height: 40, borderRadius: 11, background: '#EFF6FF', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
        <svg width="20" height="20" fill="none" stroke="#3B82F6" strokeWidth="1.8" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"/></svg>
      </div>
    ),
  },
  {
    title: 'جدول المهام والمواعيد',
    desc: 'توزيع المهام على الفريق، متابعة التقدم، وتنبيهات المواعيد النهائية.',
    iconBg: '#F0FDF4',
    icon: (
      <div style={{ width: 40, height: 40, borderRadius: 11, background: '#F0FDF4', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
        <svg width="20" height="20" fill="none" stroke="#16A34A" strokeWidth="1.8" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4"/></svg>
      </div>
    ),
  },
]

export default function OfficeManagement() {
  return (
    <section id="office" style={{ padding: '90px 0', background: '#F8F5EF' }}>
      <div className="px-page" style={{ maxWidth: 1280, margin: '0 auto' }}>
        <div className="rg-off">

          {/* Right: copy */}
          <div style={{ textAlign: 'right' }}>
            <span className="g-gold" style={{ color: '#fff', fontSize: 11, fontWeight: 900, padding: '7px 20px', borderRadius: 100, display: 'inline-block', marginBottom: 20, letterSpacing: 2 }}>إدارة المكتب</span>
            <h2 style={{ fontSize: 38, fontWeight: 900, color: 'var(--navy)', marginBottom: 18, lineHeight: 1.3 }}>
              كل ما يحتاجه مكتبك <span className="t-gold">في شاشة واحدة</span>
            </h2>
            <p style={{ fontSize: 15, color: '#64748B', lineHeight: 1.9, marginBottom: 30 }}>
              من الموظفين إلى الماليات، من جدول المواعيد إلى أداء الفريق — دُسْتُورِي يعطيك رؤية 360° على مكتبك القانوني في الوقت الحقيقي.
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              {features.map((f) => (
                <div key={f.title} style={{ display: 'flex', alignItems: 'flex-start', gap: 14, justifyContent: 'flex-end' }}>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: 14, fontWeight: 800, color: 'var(--navy)', marginBottom: 3 }}>{f.title}</div>
                    <div style={{ fontSize: 13, color: '#64748B', lineHeight: 1.7 }}>{f.desc}</div>
                  </div>
                  {f.icon}
                </div>
              ))}
            </div>
          </div>

          {/* Left: dashboard mockup */}
          <div style={{ background: 'var(--navy)', borderRadius: 20, overflow: 'hidden', border: '1px solid rgba(255,255,255,.08)' }} dir="rtl">
            <div style={{ background: '#0A0F1E', padding: '14px 18px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid rgba(255,255,255,.06)' }}>
              <div style={{ display: 'flex', gap: 5 }}>
                <div style={{ width: 9, height: 9, borderRadius: '50%', background: '#FF5F57' }} />
                <div style={{ width: 9, height: 9, borderRadius: '50%', background: '#FEBC2E' }} />
                <div style={{ width: 9, height: 9, borderRadius: '50%', background: '#28C840' }} />
              </div>
              <span style={{ fontSize: 11, fontWeight: 800, color: 'rgba(255,255,255,.4)' }}>إدارة المكتب — دُسْتُورِي</span>
              <div style={{ width: 50 }} />
            </div>
            <div style={{ padding: 18 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
                <span style={{ fontSize: 11, color: 'rgba(255,255,255,.3)', fontWeight: 600 }}>يونيو 2026</span>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 900, color: '#fff' }}>مكتب الشوبكي للمحاماة</div>
                  <div style={{ fontSize: 10, color: 'rgba(255,255,255,.3)', marginTop: 1, fontWeight: 600 }}>ترخيص نقابة المحامين #4521</div>
                </div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 8, marginBottom: 14 }}>
                {[{ v: '32', l: 'قضية نشطة', c: 'var(--gold)' }, { v: '4', l: 'محامين', c: '#34D399' }, { v: '8.2K', l: 'دينار هذا الشهر', c: '#60A5FA' }].map((s) => (
                  <div key={s.l} style={{ background: '#1E2435', borderRadius: 10, padding: 10, textAlign: 'center' }}>
                    <div style={{ fontSize: 20, fontWeight: 900, color: s.c }}>{s.v}</div>
                    <div style={{ fontSize: 8, color: 'rgba(255,255,255,.35)', marginTop: 2, fontWeight: 600 }}>{s.l}</div>
                  </div>
                ))}
              </div>
              <div style={{ background: '#1E2435', borderRadius: 10, overflow: 'hidden', marginBottom: 12 }}>
                <div style={{ padding: '8px 12px', borderBottom: '1px solid rgba(255,255,255,.05)', fontSize: 9, fontWeight: 800, color: 'rgba(255,255,255,.3)' }}>الفريق القانوني</div>
                {[
                  { name: 'المحامي خالد الشوبكي — شريك', badge: 'نشط', bg: 'rgba(52,211,153,.15)', c: '#34D399' },
                  { name: 'المحامية ريم العمري — محامية', badge: 'في مرافعة', bg: 'rgba(200,168,75,.15)', c: 'var(--gold)' },
                  { name: 'المحامي ماجد النعيمي — متدرب', badge: 'متاح', bg: 'rgba(96,165,250,.15)', c: '#60A5FA' },
                ].map((row, i) => (
                  <div key={i} style={{ padding: '8px 12px', borderBottom: i < 2 ? '1px solid rgba(255,255,255,.04)' : undefined, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <span style={{ fontSize: 8, background: row.bg, color: row.c, padding: '2px 7px', borderRadius: 4, fontWeight: 700 }}>{row.badge}</span>
                    <span style={{ fontSize: 9, color: 'rgba(255,255,255,.7)', fontWeight: 600 }}>{row.name}</span>
                  </div>
                ))}
              </div>
              <div style={{ background: '#1E2435', borderRadius: 10, padding: '10px 12px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                  <span style={{ fontSize: 9, color: 'rgba(255,255,255,.3)', fontWeight: 600 }}>الإيرادات — 2026</span>
                  <span style={{ fontSize: 9, color: 'var(--gold)', fontWeight: 700 }}>+18% عن العام الماضي</span>
                </div>
                <div style={{ display: 'flex', gap: 4, alignItems: 'flex-end', height: 32 }}>
                  {[55, 65, 45, 75, 60, 100].map((h, i) => (
                    <div key={i} style={{ flex: 1, background: i === 5 ? 'var(--gold)' : 'rgba(200,168,75,.3)', borderRadius: '3px 3px 0 0', height: `${h}%` }} />
                  ))}
                </div>
              </div>
            </div>
          </div>

        </div>
      </div>
    </section>
  )
}
