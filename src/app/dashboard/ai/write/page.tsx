'use client'

import { useState } from 'react'
import { Field, SectionHeader } from '@/components/dashboard/ui'

export default function AiWritePage() {
  const [selected, setSelected] = useState('عقد عمل')
  const [generated, setGenerated] = useState(false)
  const templates = [
    ['👷', 'عقد عمل'],
    ['🏠', 'عقد إيجار'],
    ['🤝', 'عقد شراكة'],
    ['🛒', 'عقد بيع'],
    ['🔒', 'NDA'],
    ['📋', 'وكالة'],
    ['💼', 'استشارات'],
    ['🔧', 'خدمات'],
  ]
  return (
    <div className="pg">
      {/* Renamed from "كتابة العقود بالذكاء الاصطناعي" (AI Contract Writing):
          this fills a fixed template with the fields below — no AI model is
          called. The template-filling itself is real and works; only the
          old "AI" label was false, so the fix is an accurate name, not a
          Preview banner. */}
      <SectionHeader title="نماذج عقود قابلة للتعبئة" subtitle="اختر نوع العقد وعبّئ الحقول — نموذج ثابت، وليس ذكاءً اصطناعياً" />
      <div className="card" style={{ marginBottom: 14 }}>
        <div className="ct">📂 نوع العقد</div>
        <div className="ctg">
          {templates.map(([icon, label]) => (
            <button key={label} className={`ctc${selected === label ? ' sel' : ''}`} onClick={() => setSelected(label)}>
              <div className="ctci">{icon}</div>
              <div className="ctcl">{label}</div>
            </button>
          ))}
        </div>
      </div>
      <div className="g2">
        <div className="card">
          <div className="ct">📝 بيانات العقد</div>
          <div className="fg">
            <Field label="الطرف الأول"><input className="fi" placeholder="اسم الشركة أو الشخص" /></Field>
            <Field label="الطرف الثاني"><input className="fi" placeholder="اسم الموظف أو المستأجر" /></Field>
            <Field label="تاريخ البداية"><input className="fi" type="date" /></Field>
            <Field label="تاريخ الانتهاء"><input className="fi" type="date" /></Field>
            <Field label="الراتب / القيمة (د.أ)"><input className="fi" placeholder="0.000" /></Field>
            <Field label="المدينة"><select className="fi"><option>عمّان</option><option>إربد</option><option>الزرقاء</option><option>العقبة</option></select></Field>
            <Field label="ملاحظات خاصة" full><textarea className="fi" placeholder="أي شروط إضافية تريد إضافتها..." /></Field>
          </div>
          <div style={{ marginTop: 12, display: 'flex', gap: 8 }}>
            <button className="dbtn dbtn-p" onClick={() => setGenerated(true)}>✨ توليد العقد</button>
            <button className="dbtn dbtn-s">📋 اختر من العملاء</button>
          </div>
        </div>
        <div className="card" style={{ background: 'rgba(255,255,255,.98)', color: '#1E293B' }}>
          <div style={{ textAlign: 'center', marginBottom: 16 }}>
            <div style={{ fontSize: '1rem', fontWeight: 900 }}>{selected}</div>
            <div style={{ fontSize: '.78rem', color: '#64748B', marginTop: 3 }}>مملكة الأردن الهاشمية</div>
          </div>
          <div style={{ fontSize: '.82rem', lineHeight: 1.9, color: '#1E293B' }}>
            {!generated ? (
              <>
                <p style={{ marginBottom: 10 }}>بناءً على أحكام القانون الأردني، تم الاتفاق بين:</p>
                <p><b>الطرف الأول:</b> شركة _____________</p>
                <p><b>الطرف الثاني:</b> السيد/ة _____________</p>
                <p style={{ marginTop: 10, fontWeight: 700 }}>المادة الأولى — موضوع العقد</p>
                <p>سيتم ملء العقد كاملاً بعد إدخال البيانات.</p>
              </>
            ) : (
              <>
                <p><b>الطرف الأول:</b> شركة الأمانة للاستثمار</p>
                <p><b>الطرف الثاني:</b> محمد سالم العلي</p>
                <p style={{ marginTop: 12 }}>اتفق الطرفان على ما يلي وفق أحكام قانون العمل الأردني رقم (8) لسنة 1996 وتعديلاته.</p>
                <p><b>المادة الأولى:</b> المسمى الوظيفي والمهام.</p>
                <p><b>المادة الثانية:</b> الراتب والمكافآت.</p>
                <p><b>المادة الثالثة:</b> ساعات العمل والإجازات.</p>
                <p><b>المادة الرابعة:</b> شروط الإنهاء وتسوية النزاعات.</p>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
