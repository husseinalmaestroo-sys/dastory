const CheckIcon = () => (
  <svg width="16" height="16" fill="var(--gold)" viewBox="0 0 20 20">
    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd"/>
  </svg>
)

interface FeatureCardProps {
  title: string
  desc: string
  items: string[]
  dark?: boolean
  badge?: string
  iconBg: string
  icon: React.ReactNode
}

function FeatureCard({ title, desc, items, dark, badge, iconBg, icon }: FeatureCardProps) {
  return (
    <div
      className="fcard rv"
      style={{
        background: dark ? 'var(--navy)' : '#fff',
        borderRadius: 20, padding: '32px 28px',
        border: dark ? '1.5px solid rgba(200,168,75,.25)' : '1.5px solid #E8E8E8',
        textAlign: 'right', position: 'relative', overflow: 'hidden',
      }}
    >
      {badge && (
        <div style={{ position: 'absolute', top: 18, left: 18 }}>
          {dark
            ? <span className="g-gold" style={{ color: '#fff', fontSize: 10, fontWeight: 900, padding: '4px 14px', borderRadius: 100 }}>{badge}</span>
            : <span style={{ background: 'rgba(200,168,75,.18)', color: 'var(--gold)', fontSize: 10, fontWeight: 900, padding: '4px 14px', borderRadius: 100, border: '1px solid rgba(200,168,75,.3)' }}>{badge}</span>
          }
        </div>
      )}
      <div style={{ width: 52, height: 52, borderRadius: 14, background: iconBg, display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 20, marginTop: badge ? 28 : 0 }}>
        {icon}
      </div>
      <h3 style={{ fontSize: 17, fontWeight: 900, color: dark ? '#fff' : 'var(--navy)', marginBottom: 10 }}>{title}</h3>
      <p style={{ fontSize: 13.5, color: dark ? 'rgba(255,255,255,.87)' : '#64748B', lineHeight: 1.8, marginBottom: 18 }}>{desc}</p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 13, color: dark ? 'rgba(255,255,255,.92)' : '#475569' }}>
        {items.map((item) => (
          <div key={item} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <CheckIcon />
            <span>{item}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

export default function Features() {
  const cards: FeatureCardProps[] = [
    {
      title: 'قاعدة التشريعات والقوانين الأردنية',
      desc: 'الدستور والقوانين والأنظمة والتعليمات والتعديلات والأحكام القضائية والمبادئ — بحث بالنص الكامل ورقم المادة والقانون والتاريخ.',
      items: ['+10,000 تشريع أردني محدّث يومياً', 'ربط المواد بالأحكام القضائية', 'إظهار المواد المرتبطة وآخر التعديلات'],
      iconBg: 'rgba(30,58,138,.06)',
      icon: <svg width="26" height="26" fill="none" stroke="var(--royal)" strokeWidth="1.5" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253"/></svg>,
    },
    {
      title: 'البحث القانوني الذكي',
      desc: 'بحث باللغة الطبيعية يعرض المواد القانونية والأحكام والمراجع المرتبطة بسؤالك — كل إجابة مع رقم المادة واسم القانون.',
      items: ['فهم اللغة العربية القانونية', 'مصادر موثّقة بالمرجع القانوني', 'نظام RAG على التشريعات الأردنية'],
      dark: true, badge: 'الأكثر طلباً',
      iconBg: 'transparent',
      icon: (
        <div className="g-gold" style={{ width: 52, height: 52, borderRadius: 14, display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 4px 16px rgba(200,168,75,.4)' }}>
          <svg width="26" height="26" fill="none" stroke="white" strokeWidth="1.5" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/></svg>
        </div>
      ),
    },
    {
      title: 'توليد المستندات القانونية',
      desc: 'توليد لوائح الدعوى والمذكرات والعقود والإنذارات والاستشارات اعتماداً على بيانات القضية مع إمكانية التعديل.',
      items: ['نماذج عقود أردنية قياسية', 'مذكرات ودفوع قانونية تلقائية', 'توقيع إلكتروني متكامل'],
      iconBg: 'rgba(30,58,138,.06)',
      icon: <svg width="26" height="26" fill="none" stroke="var(--royal)" strokeWidth="1.5" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/></svg>,
    },
    {
      title: 'إدارة المحاكم والدوائر القضائية',
      desc: 'قاعدة بيانات للمحاكم وأنواع القضايا ودرجات التقاضي، مع إدارة المحكمة ورقم الدعوى والقاضي والجلسات والحالة.',
      items: ['ربط بوابة المحاكم الإلكترونية', 'جميع درجات التقاضي الأردنية', 'أحكام وقرارات فورية'],
      iconBg: '#FFF7ED',
      icon: <svg width="26" height="26" fill="none" stroke="#EA580C" strokeWidth="1.5" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M8 14v3m4-3v3m4-3v3M3 21h18M3 10h18M3 7l9-4 9 4M4 10h16v11H4V10z"/></svg>,
    },
    {
      title: 'تقويم الجلسات والإشعارات',
      desc: 'تقويم يومي وأسبوعي وشهري مع تنبيهات للجلسات والاجتماعات والمهام وانتهاء الوكالات والعقود.',
      items: ['تنبيهات تلقائية للمواعيد', 'تذكير بانتهاء الوكالات والعقود', 'تزامن مع تقويم الجلسات المحلي'],
      iconBg: 'rgba(200,168,75,.08)',
      icon: <svg width="26" height="26" fill="none" stroke="var(--gold2)" strokeWidth="1.5" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"/></svg>,
    },
    {
      title: 'إدارة الأتعاب والفواتير',
      desc: 'إدارة الأتعاب والدفعات والمصروفات والفواتير والإيصالات وكشف الحساب وربحية كل قضية بشكل تفصيلي.',
      items: ['فوترة وتحصيل الأتعاب', 'كشف حساب الموكل الفوري', 'تحليل ربحية كل قضية'],
      iconBg: 'rgba(200,168,75,.08)',
      icon: <svg width="26" height="26" fill="none" stroke="var(--gold2)" strokeWidth="1.5" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>,
    },
    {
      title: 'بوابة الموكل',
      desc: 'تمكّن الموكل من متابعة قضيته والجلسات والوثائق والفواتير والدفعات والتواصل مع المكتب مباشرة.',
      items: ['متابعة القضية لحظة بلحظة', 'استعراض الفواتير ودفعها', 'تحميل الوثائق والمستندات'],
      iconBg: '#EFF6FF',
      icon: <svg width="26" height="26" fill="none" stroke="#3B82F6" strokeWidth="1.5" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"/></svg>,
    },
    {
      title: 'تطبيق المحامي ونظام ERP',
      desc: 'متابعة القضايا وتحديثها ورفع الملفات وتسجيل الملاحظات الصوتية، مع ERP شامل: HR وCRM ومحاسبة ومستندات.',
      items: ['تسجيل صوتي → نص تلقائياً', 'موارد بشرية وإدارة فريق العمل', 'محاسبة ورواتب متكاملة'],
      iconBg: '#FAF5FF',
      icon: <svg width="26" height="26" fill="none" stroke="#9333EA" strokeWidth="1.5" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M12 18h.01M8 21h8a2 2 0 002-2v-2M8 21a2 2 0 01-2-2v-2m14 0H4m0 0V9a2 2 0 012-2h12a2 2 0 012 2v8"/></svg>,
    },
    {
      title: 'AI Legal Copilot والتحليلات',
      desc: 'مساعد قانوني في كل شاشات النظام يشرح المواد ويقترح الدفوع ويلخص القضايا، مع لوحات تشغيلية ومالية متكاملة.',
      items: ['اقتراح الأحكام والدفوع القانونية', 'مقارنة نسخ القوانين والتعديلات', 'تحليلات الأداء ومؤشرات المكتب'],
      dark: true, badge: 'مدعوم بالذكاء الاصطناعي',
      iconBg: 'rgba(200,168,75,.12)',
      icon: <svg width="26" height="26" fill="none" stroke="var(--gold2)" strokeWidth="1.5" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z"/></svg>,
    },
  ]

  return (
    <section id="features" style={{ padding: '90px 0', background: '#F8F5EF' }}>
      <div className="px-page" style={{ maxWidth: 1280, margin: '0 auto' }}>
        <div className="rv" style={{ textAlign: 'center', marginBottom: 60 }}>
          <span className="g-gold" style={{ color: '#fff', fontSize: 11, fontWeight: 900, padding: '7px 20px', borderRadius: 100, display: 'inline-block', marginBottom: 16, letterSpacing: 2 }}>ما يميّزنا</span>
          <h2 style={{ fontSize: 38, fontWeight: 900, color: 'var(--navy)', marginBottom: 12 }}>منظومة قانونية متكاملة</h2>
          <p style={{ fontSize: 15, color: '#64748B', fontWeight: 500, maxWidth: 520, margin: '0 auto', lineHeight: 1.8 }}>كل ما يحتاجه مكتب المحاماة الأردني في مكان واحد — من البحث في التشريعات إلى إدارة الماليات</p>
        </div>
        <div className="rg3">
          {cards.map((c) => (
            <FeatureCard key={c.title} {...c} />
          ))}
        </div>
      </div>
    </section>
  )
}
