'use client'

import { useState } from 'react'

const FAQS = [
  { q: 'هل يمكنني الوصول للنظام من الهاتف المحمول؟', a: 'نعم، دُسْتُورِي يعمل بشكل كامل على الهاتف المحمول والتابلت. يمكنك متابعة قضاياك وجلساتك وإجراء البحث القانوني من أي مكان وفي أي وقت.' },
  { q: 'كيف يتم تحديث قاعدة التشريعات الأردنية؟', a: 'قاعدة التشريعات محدّثة يومياً من المصادر الرسمية (الجريدة الرسمية، ديوان التشريع والرأي). أي تشريع جديد يُضاف تلقائياً خلال 24 ساعة من نشره.' },
  { q: 'هل بياناتي وملفاتي القانونية آمنة؟', a: 'نعم، نستخدم تشفيراً من الدرجة المصرفية (AES-256). بياناتك مستضافة على خوادم آمنة معتمدة، مع نسخ احتياطية يومية وسياسة سرية صارمة.' },
  { q: 'هل يدعم النظام أكثر من محامٍ في نفس المكتب؟', a: 'نعم، يدعم دُسْتُورِي إدارة فرق عمل كاملة — محامون، متدربون، سكرتارية — مع صلاحيات مختلفة لكل دور وإمكانية متابعة أداء كل عضو في الفريق.' },
  { q: 'هل يمكن لموكلي متابعة قضيته مباشرة؟', a: 'نعم، يوفر النظام بوابة موكل مستقلة يتابع من خلالها الجلسات والوثائق والفواتير دون الحاجة للاتصال بالمكتب، مما يعزز ثقة الموكل ويوفر وقت المحامي.' },
]

export default function FAQ() {
  const [open, setOpen] = useState<number | null>(null)

  return (
    <section id="faq" style={{ padding: '90px 0', background: '#F8F5EF' }}>
      <div className="px-page" style={{ maxWidth: 800, margin: '0 auto' }}>
        <div className="rv" style={{ textAlign: 'center', marginBottom: 50 }}>
          <span className="g-gold" style={{ color: '#fff', fontSize: 11, fontWeight: 900, padding: '7px 20px', borderRadius: 100, display: 'inline-block', marginBottom: 16, letterSpacing: 2 }}>الأسئلة الشائعة</span>
          <h2 style={{ fontSize: 36, fontWeight: 900, color: 'var(--navy)' }}>أسئلة يسألها عملاؤنا</h2>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {FAQS.map((faq, i) => (
            <div key={i} className="rv" style={{ background: '#fff', borderRadius: 16, border: '1.5px solid #E8E8E8', overflow: 'hidden' }}>
              <button
                onClick={() => setOpen(open === i ? null : i)}
                style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '20px 24px', textAlign: 'right', background: 'none', border: 'none', cursor: 'pointer', fontFamily: "'Cairo', sans-serif" }}
              >
                <svg style={{ transition: 'transform .3s', transform: open === i ? 'rotate(180deg)' : 'rotate(0)', flexShrink: 0 }} width="20" height="20" fill="none" stroke="var(--gold)" strokeWidth="2" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7"/>
                </svg>
                <span style={{ fontSize: 15, fontWeight: 800, color: 'var(--navy)', paddingRight: 12 }}>{faq.q}</span>
              </button>
              {open === i && (
                <div style={{ padding: '0 24px 20px', fontSize: 14, color: '#64748B', lineHeight: 1.8, fontWeight: 500, borderTop: '1px solid #F1F5F9' }}>
                  {faq.a}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
