const steps = [
  { emoji: '💬', title: 'اطرح سؤالك',       desc: 'اكتب استفساراً قانونياً أو ارفع وثيقة للتحليل' },
  { emoji: '🔍', title: 'البحث في التشريعات', desc: 'يبحث في القوانين والأنظمة والأحكام القضائية' },
  { emoji: '⚖️', title: 'استخراج المواد',    desc: 'يُحدّد المواد القانونية الأكثر صلة بسؤالك' },
  { emoji: '📋', title: 'إجابة مُسندة',      desc: 'رأي مكتوب يذكر المادة ومصدر نصها، ويصرّح إن لم يجد سنداً' },
]

const modules = [
  {
    emoji: '📄', title: 'مراجعة العقود', sub: '12 نقطة تحليل تلقائياً',
    borderColor: 'rgba(212,175,55,.18)', bg: 'rgba(212,175,55,.06)',
    dotColor: '#4ADE80',
    iconStyle: { background: 'linear-gradient(135deg,#D4AF37,#C5A059)' },
    items: ['استخراج الأطراف والقيمة والمدة', 'تحديد البنود الخطرة والناقصة', 'اقتراح تعديلات وإعادة صياغة', 'شروط الإنهاء وبنود السرية', 'مقارنة مع عقد سابق'],
  },
  {
    emoji: '🔎', title: 'البحث القانوني', sub: '4 مصادر قانونية أردنية',
    borderColor: 'rgba(37,99,235,.2)', bg: 'rgba(37,99,235,.06)',
    dotColor: '#60A5FA',
    iconStyle: { background: 'linear-gradient(135deg,#1E3A8A,#2563EB)' },
    items: ['القوانين والأنظمة الأردنية', 'اللوائح والتعليمات', 'قرارات الديوان الخاص بتفسير القوانين', 'عرض نص المادة وسبب اختيارها', 'التصريح عند غياب السند'],
  },
  {
    emoji: '🧠', title: 'تحليل القضايا', sub: '10 محاور تحليل استراتيجي',
    borderColor: 'rgba(16,185,129,.2)', bg: 'rgba(16,185,129,.06)',
    dotColor: '#34D399',
    iconStyle: { background: 'linear-gradient(135deg,#059669,#10B981)' },
    items: ['تلخيص الملف واقتراح الاستراتيجية', 'نقاط القوة والضعف والمخاطر', 'المستندات الناقصة والإجراءات الفائتة', 'أسئلة للشهود والاستجواب', 'استخراج التواريخ والأسماء والمراسلات'],
  },
]

export default function AIEngine() {
  return (
    <section id="ai-engine" className="arabesque" style={{ padding: '90px 0' }}>
      <div className="px-page" style={{ maxWidth: 1280, margin: '0 auto' }}>

        {/* Header */}
        <div className="rv" style={{ textAlign: 'center', marginBottom: 60 }}>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 10, background: 'rgba(200,168,75,.12)', border: '1px solid rgba(200,168,75,.25)', borderRadius: 100, padding: '8px 20px', marginBottom: 18 }}>
            <span style={{ fontSize: 11, fontWeight: 900, color: 'rgba(255,255,255,.7)', letterSpacing: 2 }}>مُدرَّب على القانون الأردني</span>
          </div>
          <h2 style={{ fontSize: 38, fontWeight: 900, color: '#fff', marginBottom: 14, lineHeight: 1.3 }}>
            ذكاء اصطناعي يعرف <span className="t-gold">القانون الأردني</span>
          </h2>
          <p style={{ fontSize: 15, color: 'rgba(255,255,255,.5)', fontWeight: 500, maxWidth: 560, margin: '0 auto', lineHeight: 1.9 }}>
            كل إجابة مستندة إلى نصوص قانونية حقيقية — لا تخمين، لا اجتهاد.<br />RAG على التشريعات الأردنية الكاملة.
          </p>
        </div>

        {/* Pipeline */}
        <div className="rv rg-pipe" style={{ marginBottom: 60, position: 'relative' }}>
          <div className="mob-hide" style={{ position: 'absolute', top: 36, right: '12.5%', left: '12.5%', height: 2, background: 'linear-gradient(90deg,rgba(212,175,55,.5),rgba(212,175,55,.1))', zIndex: 0 }} />
          {steps.map((s) => (
            <div key={s.title} style={{ textAlign: 'center', padding: '0 16px', position: 'relative', zIndex: 1 }}>
              <div style={{ width: 72, height: 72, borderRadius: '50%', background: 'rgba(212,175,55,.12)', border: '2px solid rgba(212,175,55,.3)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px', fontSize: '1.6rem' }}>{s.emoji}</div>
              <div style={{ fontSize: 13, fontWeight: 900, color: '#fff', marginBottom: 6 }}>{s.title}</div>
              <div style={{ fontSize: 12, color: 'rgba(255,255,255,.4)', lineHeight: 1.7 }}>{s.desc}</div>
            </div>
          ))}
        </div>

        {/* 3 modules */}
        <div className="rg3" style={{ marginBottom: 40 }}>
          {modules.map((m) => (
            <div key={m.title} className="rv" style={{ background: m.bg, border: `1px solid ${m.borderColor}`, borderRadius: 18, padding: 24 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 18 }}>
                <div style={{ width: 40, height: 40, borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.1rem', flexShrink: 0, ...m.iconStyle }}>{m.emoji}</div>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 900, color: '#fff' }}>{m.title}</div>
                  <div style={{ fontSize: 11, color: 'rgba(255,255,255,.5)', marginTop: 2 }}>{m.sub}</div>
                </div>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
                {m.items.map((it) => (
                  <div key={it} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'rgba(255,255,255,.6)' }}>
                    <span style={{ color: m.dotColor, fontSize: 10 }}>●</span> {it}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        {/* Bottom note */}
        <div className="rv" style={{ background: 'rgba(200,168,75,.06)', border: '1px solid rgba(200,168,75,.2)', borderRadius: 18, padding: '24px 32px', display: 'flex', alignItems: 'center', gap: 20, flexDirection: 'row-reverse', maxWidth: 860, margin: '0 auto' }}>
          <div className="g-gold" style={{ width: 48, height: 48, borderRadius: 13, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <svg width="24" height="24" fill="none" stroke="white" strokeWidth="1.8" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z"/></svg>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: 15, fontWeight: 900, color: '#fff', marginBottom: 5 }}>لا تخمين — كل إجابة تذكر سندها أو تصرّح بغيابه</div>
            <div style={{ fontSize: 13, color: 'rgba(255,255,255,.5)', lineHeight: 1.7 }}>دُسْتُورِي لا يولّد إجابات من فراغ. يبحث أولاً في نصوص التشريعات الأردنية المحفوظة في قاعدة البيانات، ثم يصيغ الرأي مستنداً إليها مع ذكر المادة ومصدر النص وما إذا قورن بالجريدة الرسمية؛ وإن لم يجد سنداً قال ذلك صراحة.</div>
          </div>
        </div>

      </div>
    </section>
  )
}
