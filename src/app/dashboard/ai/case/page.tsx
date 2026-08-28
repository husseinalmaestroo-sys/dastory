'use client'

import { useState } from 'react'
import { Badge, Risk, SectionHeader } from '@/components/dashboard/ui'

export default function AiCasePage() {
  const [analyzed, setAnalyzed] = useState(false)
  const [tab, setTab] = useState<'strategy' | 'strength' | 'witnesses' | 'docs'>('strategy')
  return (
    <div className="pg">
      <SectionHeader title="تحليل القضايا بالذكاء الاصطناعي" subtitle="عرض توضيحي (Preview) — غير متصل حالياً بتحليل ذكاء اصطناعي حقيقي" />
      <div style={{ background: 'rgba(245,158,11,.07)', border: '1px solid rgba(245,158,11,.2)', borderRadius: 11, padding: '12px 16px', marginBottom: 16, fontSize: '.8rem', color: '#F59E0B', lineHeight: 1.8 }}>
        ⚠️ هذه الصفحة عرض توضيحي (Preview) لواجهة الاستخدام فقط — البيانات أدناه أمثلة ثابتة، وليست تحليلاً حقيقياً لأي قضية. للتحليل الحقيقي المتصل بذكاء اصطناعي فعلي استخدم <b>مراجعة العقود بالذكاء الاصطناعي</b>.
      </div>
      <div className="g2">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div className="card">
            <div className="ct">📂 اختر القضية</div>
            <select className="fi" style={{ marginBottom: 12 }}>
              <option>2024/1847 — نزاع عمالي — شركة الأمانة</option>
              <option>2024/2031 — دعوى مدنية — أحمد المصري</option>
              <option>2024/1701 — تجاري — مجموعة النور</option>
            </select>
            <button className="upl" style={{ padding: 20 }} onClick={() => setAnalyzed(true)}><div className="uic">📎</div><div className="ut">أو ارفع ملف القضية</div></button>
            <div style={{ marginTop: 10, display: 'flex', gap: 7, flexWrap: 'wrap' }}>
              <button className="dbtn dbtn-p" onClick={() => setAnalyzed(true)}>🧠 تحليل شامل</button>
              <button className="dbtn dbtn-s" onClick={() => setTab('strategy')}>📋 استراتيجية</button>
              <button className="dbtn dbtn-s" onClick={() => setTab('witnesses')}>👥 أسئلة الشهود</button>
              <button className="dbtn dbtn-s" onClick={() => setTab('docs')}>📅 المستندات</button>
            </div>
          </div>
          {analyzed && (
            <div className="card">
              <div className="ct">📊 ملخص القضية</div>
              <div className="arr"><span className="lb">نوع القضية</span><span className="vl">نزاع عمالي — فصل تعسفي</span></div>
              <div className="arr"><span className="lb">الموكل</span><span className="vl">شركة الأمانة للاستثمار</span></div>
              <div className="arr"><span className="lb">الخصم</span><span className="vl">محمد سالم العلي</span></div>
              <div className="arr"><span className="lb">المطالبة</span><span className="vl">12,000 دينار تعويض + إعادة توظيف</span></div>
              <div className="arr"><span className="lb">احتمال الفوز</span><span className="vl"><Badge type="pe">65% — متوسط</Badge></span></div>
            </div>
          )}
        </div>
        {analyzed && (
          <div className="card">
            <div className="tabs">
              <button className={`tb${tab === 'strategy' ? ' active' : ''}`} onClick={() => setTab('strategy')}>الاستراتيجية</button>
              <button className={`tb${tab === 'strength' ? ' active' : ''}`} onClick={() => setTab('strength')}>نقاط القوة/الضعف</button>
              <button className={`tb${tab === 'witnesses' ? ' active' : ''}`} onClick={() => setTab('witnesses')}>الشهود</button>
              <button className={`tb${tab === 'docs' ? ' active' : ''}`} onClick={() => setTab('docs')}>المستندات</button>
            </div>
            {tab === 'strategy' && (
              <div className="tp active">
                <Risk type="ok" title="✅ الاستراتيجية الموصى بها" text="التركيز على إثبات عدم صحة إجراء الإنهاء وفق المادة 32 من قانون العمل." />
                <Risk type="wn" title="⚠️ خطر — الطرف المقابل يمتلك سجلات حضور" text="يجب الطعن في دقة هذه السجلات أو إثبات التناقض فيها." />
                <Risk type="ok" title="✅ مستندات قوية بحوزتنا" text="رسائل بريد إلكتروني تثبت التمييز + شهادة زميلين." />
              </div>
            )}
            {tab === 'strength' && (
              <div className="tp active">
                <Risk type="ok" title="نقطة قوة" text="عدم وجود إنذار مسبق قبل الفصل — مخالفة صريحة للإجراءات." />
                <Risk type="ok" title="نقطة قوة" text="مدة الخدمة 7 سنوات تعزز مطالبة التعويض." />
                <Risk type="dn" title="نقطة ضعف" text="الطرف المقابل يدّعي وجود مخالفات إدارية موثقة." />
              </div>
            )}
            {tab === 'witnesses' && <div className="tp active" style={{ fontSize: '.8rem', color: '#CBD5E1', lineHeight: 1.9 }}>1. هل تم توجيه إنذار كتابي قبل قرار الفصل؟<br />2. من أصدر قرار الإنهاء وما صلاحياته؟<br />3. هل اتُّبعت إجراءات النظام الداخلي كاملة؟</div>}
            {tab === 'docs' && (
              <div className="tp active">
                <Risk type="dn" title="❌ مستند ناقص — قرار الفصل الرسمي" text="لم نستلم نسخة موقعة من قرار إنهاء الخدمة." />
                <Risk type="wn" title="⚠️ مطلوب — كشف الراتب آخر 6 أشهر" text="لحساب التعويض المستحق بدقة." />
                <Risk type="ok" title="✅ متوفر — عقد العمل الأصلي وملاحقه" text="مرفق ضمن ملف القضية." />
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
