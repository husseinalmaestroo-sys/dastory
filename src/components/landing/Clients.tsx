const testimonials = [
  {
    city: 'عمّان، الأردن',
    quote: '"دُسْتُورِي غيّر طريقة عملنا جذرياً. البحث في التشريعات الذي كان يستغرق ساعات أصبح يأخذ دقائق، وإدارة القضايا أصبحت منظّمة بشكل احترافي."',
    name: 'المحامي خالد الشوبكي',
    firm: 'مكتب الشوبكي للمحاماة',
    initial: 'خ',
    avatarClass: 'g-navy',
  },
  {
    city: 'إربد، الأردن',
    quote: '"نظام ERP المتكامل وفّر علينا محاسباً خارجياً. الآن نُدير الأتعاب والفواتير والمصروفات بأنفسنا بشكل دقيق ومنظّم."',
    name: 'المحامية سارة الزعبي',
    firm: 'الزعبي للمحاماة والاستشارات',
    initial: 'س',
    avatarClass: 'g-gold',
  },
  {
    city: 'الزرقاء، الأردن',
    quote: '"تكامل النظام مع محاكم الأردن حوّل كيفية متابعة قضايانا. الآن نعلم بكل جلسة وحكم فور صدوره مباشرة في النظام."',
    name: 'المستشار محمد النمر',
    firm: 'مجموعة النمر القانونية',
    initial: 'م',
    avatarBg: '#16A34A',
  },
]

export default function Clients() {
  return (
    <section id="clients" style={{ padding: '90px 0', background: '#fff' }}>
      <div className="px-page" style={{ maxWidth: 1280, margin: '0 auto' }}>
        <div className="rv" style={{ textAlign: 'center', marginBottom: 60 }}>
          <span className="g-gold" style={{ color: '#fff', fontSize: 11, fontWeight: 900, padding: '7px 20px', borderRadius: 100, display: 'inline-block', marginBottom: 16, letterSpacing: 2 }}>رواد القانون في الأردن</span>
          <h2 style={{ fontSize: 38, fontWeight: 900, color: 'var(--navy)', marginBottom: 12 }}>مكاتب تثق بدُسْتُورِي</h2>
          <p style={{ fontSize: 15, color: '#64748B', fontWeight: 500 }}>شركاؤنا الذين وثقوا فينا — كن التالي ضمن رواد التحول الرقمي القانوني في الأردن</p>
        </div>
        <div className="rg3">
          {testimonials.map((t) => (
            <div key={t.name} className="tcard rv" style={{ border: '1.5px solid #E8E8E8', borderRadius: 20, padding: 28, textAlign: 'right' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16, alignItems: 'flex-start' }}>
                <div style={{ fontSize: 12, color: '#94A3B8', fontWeight: 600 }}>{t.city}</div>
                <span style={{ color: 'var(--gold)', fontSize: 14 }}>★★★★★</span>
              </div>
              <p style={{ fontSize: 13.5, color: '#475569', lineHeight: 1.8, marginBottom: 20 }}>{t.quote}</p>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, justifyContent: 'flex-end' }}>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: 14, fontWeight: 800, color: 'var(--navy)' }}>{t.name}</div>
                  <div style={{ fontSize: 12, color: '#94A3B8', fontWeight: 600 }}>{t.firm}</div>
                </div>
                <div
                  className={t.avatarClass}
                  style={{ width: 42, height: 42, borderRadius: '50%', background: t.avatarBg, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 15, fontWeight: 900 }}
                >
                  {t.initial}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
