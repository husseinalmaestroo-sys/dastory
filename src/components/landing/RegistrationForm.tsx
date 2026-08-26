'use client'

import { useState, type CSSProperties, type FormEvent, type ReactNode } from 'react'

type FormState = {
  officeName: string
  officeLicense: string
  city: string
  officePhone: string
  address: string
  teamSize: string
  specialty: string
  lawyerName: string
  lawyerBarNumber: string
  email: string
  mobile: string
  nationalId: string
  experience: string
}

const INITIAL_FORM: FormState = {
  officeName: '',
  officeLicense: '',
  city: '',
  officePhone: '',
  address: '',
  teamSize: '',
  specialty: '',
  lawyerName: '',
  lawyerBarNumber: '',
  email: '',
  mobile: '',
  nationalId: '',
  experience: '',
}

const CITIES = ['عمّان', 'الزرقاء', 'إربد', 'العقبة', 'السلط', 'المفرق', 'الكرك', 'معان', 'مادبا', 'جرش', 'عجلون', 'الطفيلة']
const TEAM_SIZES = ['محامٍ منفرد', '2-5 محامين', '6-20 محامياً', 'أكثر من 20 محامياً']
const SPECIALTIES = ['قانون مدني وتجاري', 'قانون جزائي', 'قانون أسرة وأحوال شخصية', 'قانون عمل', 'قانون إداري', 'قانون عقارات', 'تخصصات متعددة']
const EXPERIENCE = ['أقل من سنة', '1-3 سنوات', '4-10 سنوات', 'أكثر من 10 سنوات']

function Field({
  label,
  required = false,
  children,
}: {
  label: string
  required?: boolean
  children: ReactNode
}) {
  return (
    <div>
      <label style={{ display: 'block', fontSize: 13, fontWeight: 800, color: 'var(--navy)', marginBottom: 8 }}>
        {label} {required && <span style={{ color: '#EF4444' }}>*</span>}
      </label>
      {children}
    </div>
  )
}

export default function RegistrationForm() {
  const [tab, setTab] = useState(1)
  const [form, setForm] = useState<FormState>(INITIAL_FORM)
  const [acceptedTerms, setAcceptedTerms] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const inputStyle: CSSProperties = {
    width: '100%',
    background: '#F8FAFC',
    border: '2px solid #E2E8F0',
    borderRadius: 12,
    padding: '13px 14px',
    fontSize: 14,
    fontWeight: 500,
    fontFamily: "'Cairo', sans-serif",
    color: 'var(--navy)',
    transition: 'all .2s',
  }

  const setValue = (name: keyof FormState, value: string) => {
    setSubmitted(false)
    setError('')
    setForm((current) => ({ ...current, [name]: value }))
  }

  const input = (name: keyof FormState, placeholder: string, type = 'text', dir: 'rtl' | 'ltr' = 'rtl') => (
    <input
      className="inp"
      type={type}
      value={form[name]}
      onChange={(event) => setValue(name, event.target.value)}
      placeholder={placeholder}
      dir={dir}
      style={inputStyle}
    />
  )

  const select = (name: keyof FormState, options: string[], placeholder: string) => (
    <select
      className="inp"
      value={form[name]}
      onChange={(event) => setValue(name, event.target.value)}
      dir="rtl"
      style={{ ...inputStyle, appearance: 'none' }}
    >
      <option value="">{placeholder}</option>
      {options.map((option) => <option key={option} value={option}>{option}</option>)}
    </select>
  )

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setLoading(true)
    setError('')
    setSubmitted(false)

    try {
      const res = await fetch('/api/trial-requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, acceptedTerms }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(data.error || 'تعذر إرسال الطلب')
        return
      }
      setSubmitted(true)
      setForm(INITIAL_FORM)
      setAcceptedTerms(false)
      setTab(1)
    } catch {
      setError('تعذر الاتصال بالخادم')
    } finally {
      setLoading(false)
    }
  }

  return (
    <section id="trial" style={{ padding: '90px 0', background: '#F8F5EF' }}>
      <div className="px-page" style={{ maxWidth: 860, margin: '0 auto' }}>
        <div className="rv" style={{ textAlign: 'center', marginBottom: 44 }}>
          <span className="g-gold" style={{ color: '#fff', fontSize: 11, fontWeight: 900, padding: '7px 20px', borderRadius: 100, display: 'inline-block', marginBottom: 16, letterSpacing: 2 }}>سجّل مكتبك الآن</span>
          <h2 style={{ fontSize: 38, fontWeight: 900, color: 'var(--navy)', marginBottom: 10 }}>ابدأ تجربتك المجانية</h2>
          <p style={{ fontSize: 14, color: '#64748B', fontWeight: 500, lineHeight: 1.8 }}>أرسل بيانات المكتب والمحامي المسؤول، وسيتواصل معك الفريق لتفعيل التجربة بعد مراجعة البيانات.</p>
        </div>

        <form onSubmit={handleSubmit} style={{ background: '#fff', border: '2px solid #E8E8E8', borderRadius: 24, overflow: 'hidden', boxShadow: '0 8px 40px rgba(0,0,0,.05)' }} dir="rtl">
          <div style={{ display: 'flex', borderBottom: '2px solid #F1F5F9' }}>
            {[{ n: 1, label: 'بيانات المكتب' }, { n: 2, label: 'بيانات المحامي' }].map(({ n, label }) => (
              <button key={n} type="button" onClick={() => setTab(n)}
                style={{ flex: 1, padding: 18, fontSize: 14, fontWeight: 800, fontFamily: "'Cairo', sans-serif", border: 'none', cursor: 'pointer', borderBottom: tab === n ? '3px solid var(--navy)' : '3px solid transparent', color: tab === n ? 'var(--navy)' : '#94A3B8', background: '#fff', transition: 'all .2s', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, marginBottom: -2 }}>
                {label}
              </button>
            ))}
          </div>

          {tab === 1 && (
            <div className="form-inner-pad" style={{ padding: '36px 44px' }}>
              <div className="rg2">
                <Field label="اسم المكتب / الشركة" required>{input('officeName', 'مكتب الشوبكي للمحاماة والاستشارات')}</Field>
                <Field label="رقم ترخيص النقابة" required>{input('officeLicense', 'مثال: 4521', 'text', 'ltr')}</Field>
                <Field label="المدينة" required>{select('city', CITIES, 'اختر المدينة')}</Field>
                <Field label="رقم هاتف المكتب" required>{input('officePhone', '+962 6 XXX XXXX', 'tel', 'ltr')}</Field>
                <div style={{ gridColumn: '1/-1' }}>
                  <Field label="عنوان المكتب">{input('address', 'مثال: شارع الملكة نور، مجمع الرشيد، الطابق 3')}</Field>
                </div>
                <Field label="حجم فريق المحامين">{select('teamSize', TEAM_SIZES, 'اختر الحجم')}</Field>
                <Field label="التخصص القانوني الرئيسي">{select('specialty', SPECIALTIES, 'اختر التخصص')}</Field>
              </div>
              <div style={{ marginTop: 24, display: 'flex', justifyContent: 'flex-start' }}>
                <button type="button" onClick={() => setTab(2)} className="g-gold"
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 10, fontSize: 14, fontWeight: 900, color: '#fff', padding: '14px 32px', borderRadius: 12, border: 'none', cursor: 'pointer', fontFamily: "'Cairo', sans-serif", boxShadow: '0 4px 16px rgba(200,168,75,.35)' }}>
                  التالي — بيانات المحامي
                </button>
              </div>
            </div>
          )}

          {tab === 2 && (
            <div className="form-inner-pad" style={{ padding: '36px 44px' }}>
              <div className="rg2">
                <Field label="اسم المحامي المسؤول" required>{input('lawyerName', 'المحامي خالد أحمد الشوبكي')}</Field>
                <Field label="رقم نقابة المحامين" required>{input('lawyerBarNumber', 'مثال: 7832', 'text', 'ltr')}</Field>
                <Field label="البريد الإلكتروني" required>{input('email', 'lawyer@firm.jo', 'email', 'ltr')}</Field>
                <Field label="رقم الهاتف المحمول" required>{input('mobile', '+962 7X XXX XXXX', 'tel', 'ltr')}</Field>
                <Field label="رقم الهوية الوطنية" required>{input('nationalId', 'مثال: 9XXXXXXXXX', 'text', 'ltr')}</Field>
                <Field label="سنوات الخبرة">{select('experience', EXPERIENCE, 'اختر')}</Field>
              </div>

              <div style={{ marginTop: 20, display: 'flex', alignItems: 'flex-start', gap: 10, justifyContent: 'flex-end' }}>
                <p style={{ fontSize: 13, color: '#475569', fontWeight: 500, textAlign: 'right', lineHeight: 1.6 }}>
                  أوافق على <a href="/terms" target="_blank" style={{ color: 'var(--navy)', textDecoration: 'underline' }}>شروط الاستخدام</a> و<a href="/privacy" target="_blank" style={{ color: 'var(--navy)', textDecoration: 'underline' }}>سياسة الخصوصية</a>، وأقرّ بصحة البيانات المدخلة.
                </p>
                <input
                  type="checkbox"
                  checked={acceptedTerms}
                  onChange={(event) => { setAcceptedTerms(event.target.checked); setError(''); setSubmitted(false) }}
                  style={{ marginTop: 3, width: 18, height: 18, flexShrink: 0, accentColor: 'var(--navy)', cursor: 'pointer' }}
                />
              </div>

              {error && <div style={{ color: '#DC2626', fontSize: 13, fontWeight: 700, marginTop: 14 }}>{error}</div>}
              {submitted && <div style={{ color: '#16A34A', fontSize: 13, fontWeight: 800, marginTop: 14 }}>تم استلام طلبك. سيتواصل معك الفريق خلال 24 ساعة.</div>}

              <div style={{ marginTop: 20, display: 'flex', gap: 12, justifyContent: 'flex-start', alignItems: 'center', flexWrap: 'wrap' }}>
                <button type="submit" disabled={loading || submitted} className="g-gold"
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 10, fontSize: 15, fontWeight: 900, color: '#fff', padding: '15px 34px', borderRadius: 12, border: 'none', cursor: loading ? 'wait' : 'pointer', boxShadow: '0 6px 24px rgba(200,168,75,.4)', fontFamily: "'Cairo', sans-serif", background: submitted ? '#16A34A' : undefined }}>
                  {loading ? 'جارٍ إرسال الطلب...' : submitted ? 'تم إرسال الطلب' : 'إرسال طلب التجربة'}
                </button>
                <button type="button" onClick={() => setTab(1)} style={{ fontSize: 13, fontWeight: 700, color: '#94A3B8', background: 'none', border: 'none', cursor: 'pointer', fontFamily: "'Cairo', sans-serif" }}>
                  رجوع لبيانات المكتب
                </button>
              </div>
            </div>
          )}
        </form>

        <div className="rv rg-i3" style={{ marginTop: 24, textAlign: 'center' }}>
          {[{ e: '🔒', t: 'حفظ الطلب بأمان', s: 'لا يتم تخزين كلمات مرور' }, { e: '📞', t: 'تواصل قريب', s: 'مراجعة خلال 24 ساعة' }, { e: '🎁', t: '30 يوماً مجاناً', s: 'بعد تفعيل الحساب' }].map((item) => (
            <div key={item.t} style={{ padding: 14, background: '#fff', borderRadius: 14, border: '1.5px solid #E8E8E8' }}>
              <div style={{ fontSize: 18, marginBottom: 4 }}>{item.e}</div>
              <div style={{ fontSize: 11, fontWeight: 800, color: 'var(--navy)' }}>{item.t}</div>
              <div style={{ fontSize: 11, color: '#94A3B8', fontWeight: 500, marginTop: 2 }}>{item.s}</div>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
