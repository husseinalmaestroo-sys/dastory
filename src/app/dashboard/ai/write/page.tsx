'use client'

import { useState } from 'react'
import { Field, SectionHeader } from '@/components/dashboard/ui'

type FieldSpec = { id: string; label: string; placeholder?: string; area?: boolean; required?: boolean }
type Group = { title: string; fields: FieldSpec[] }

// Mirrors ailegal_hussein's own field spec for drafting kind "contract"
// (ailegal_hussein/src/lib/drafting/forms.ts) field-for-field — the backend
// route (api/ai/contract-draft) validates against this exact same set, so
// keeping them in sync here is what makes every field actually reach the
// prompt instead of being silently dropped.
const GROUPS: Group[] = [
  { title: 'العقد', fields: [
    { id: 'contract_type', label: 'نوع العقد', placeholder: 'إيجار / بيع / مقاولة', required: true },
    { id: 'contract_place', label: 'مكان الإبرام', placeholder: 'عمان' },
    { id: 'jurisdiction', label: 'المحكمة المختصة', placeholder: 'محاكم عمان' },
  ] },
  { title: 'الفريق الأول', fields: [
    { id: 'party_one_name', label: 'الاسم', required: true },
    { id: 'party_one_capacity', label: 'الصفة', placeholder: 'المؤجر / البائع' },
    { id: 'party_one_id', label: 'الرقم الوطني / السجل التجاري' },
    { id: 'party_one_address', label: 'العنوان' },
  ] },
  { title: 'الفريق الثاني', fields: [
    { id: 'party_two_name', label: 'الاسم', required: true },
    { id: 'party_two_capacity', label: 'الصفة', placeholder: 'المستأجر / المشتري' },
    { id: 'party_two_id', label: 'الرقم الوطني / السجل التجاري' },
    { id: 'party_two_address', label: 'العنوان' },
  ] },
  { title: 'محل العقد والالتزامات', fields: [
    { id: 'subject', label: 'محل العقد', area: true, required: true },
    { id: 'obligations_rights', label: 'الالتزامات والحقوق', area: true },
    { id: 'consideration', label: 'البدل وطريقة الدفع' },
    { id: 'duration', label: 'المدة', placeholder: 'سنة تبدأ من 2026/1/1' },
    { id: 'termination', label: 'أحكام الإنهاء' },
  ] },
]

// Rarer clauses, kept out of the main flow — a lawyer who needs one opens
// this group; one who doesn't isn't scrolled past 15 fields to find "توليد".
const ADDITIONAL_GROUP: Group = {
  title: 'بنود إضافية (اختياري)',
  fields: [
    { id: 'confidentiality', label: 'السرية', area: true },
    { id: 'ip_terms', label: 'الملكية الفكرية', area: true },
    { id: 'breach_terms', label: 'الإخلال بالعقد', area: true },
    { id: 'penalty_clause', label: 'الشرط الجزائي', area: true },
    { id: 'force_majeure', label: 'القوة القاهرة', area: true },
    { id: 'dispute_resolution', label: 'آلية تسوية النزاعات', placeholder: 'التقاضي / التحكيم' },
    { id: 'governing_law', label: 'القانون الواجب التطبيق', placeholder: 'القانون الأردني' },
    { id: 'special_terms', label: 'شروط خاصة أخرى', area: true },
  ],
}

type Source = { ref: number; title: string; lawName: string | null; articleNumber: string | number | null; excerpt: string }
type DraftState = { draft: string; grounded: boolean; sources: Source[]; groundingLevel?: 'full' | 'partial' | 'none'; unverifiedFacts?: number }

export default function AiWritePage() {
  const [fields, setFields] = useState<Record<string, string>>({})
  const [notes, setNotes] = useState('')
  const [busy, setBusy] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [error, setError] = useState('')
  const [notConfigured, setNotConfigured] = useState(false)
  const [result, setResult] = useState<DraftState | null>(null)

  const setField = (id: string, value: string) => setFields((f) => ({ ...f, [id]: value }))

  const generate = async () => {
    setError(''); setNotConfigured(false); setResult(null)
    setBusy(true)
    try {
      const res = await fetch('/api/ai/contract-draft', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fields, notes }),
      })
      const data = await res.json()
      if (res.status === 503) { setNotConfigured(true); setError(data.error); return }
      if (!res.ok) { setError(data.error || 'تعذّر توليد العقد'); return }
      setResult(data)
    } catch {
      setError('تعذّر الاتصال بالخادم')
    } finally {
      setBusy(false)
    }
  }

  const exportFile = async (format: 'docx' | 'pdf') => {
    if (!result?.draft) return
    setExporting(true)
    try {
      const res = await fetch('/api/ai/contract-draft/export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ draft: result.draft, filename: fields.contract_type || 'عقد', format }),
      })
      if (!res.ok) { const data = await res.json().catch(() => null); setError(data?.error || 'تعذّر تصدير الملف'); return }
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${fields.contract_type || 'عقد'}.${format}`
      a.click()
      URL.revokeObjectURL(url)
    } catch {
      setError('تعذّر الاتصال بالخادم')
    } finally {
      setExporting(false)
    }
  }

  return (
    <div className="pg">
      <SectionHeader title="صياغة العقود بالذكاء الاصطناعي" subtitle="مسودة حقيقية مُسندة إلى نصوص قانونية أردنية عبر ailegal_hussein — عبّئ الحقول ثم راجعها قبل الاستخدام" />
      {notConfigured && (
        <div style={{ background: 'rgba(245,158,11,.08)', border: '1px solid rgba(245,158,11,.25)', borderRadius: 10, padding: '10px 14px', marginBottom: 16, fontSize: '.82rem', color: '#F59E0B' }}>
          ⚠️ خدمة صياغة العقود بالذكاء الاصطناعي غير مُفعّلة على هذا الخادم حالياً.
        </div>
      )}
      <div className="g2">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {GROUPS.map((g) => (
            <div className="card" key={g.title}>
              <div className="ct">{g.title}</div>
              <div className="fg">
                {g.fields.map((f) => (
                  <Field key={f.id} label={f.required ? `${f.label} *` : f.label} full={f.area}>
                    {f.area ? (
                      <textarea className="fi" placeholder={f.placeholder} value={fields[f.id] ?? ''} onChange={(e) => setField(f.id, e.target.value)} />
                    ) : (
                      <input className="fi" placeholder={f.placeholder} value={fields[f.id] ?? ''} onChange={(e) => setField(f.id, e.target.value)} />
                    )}
                  </Field>
                ))}
              </div>
            </div>
          ))}
          <details className="card">
            <summary style={{ cursor: 'pointer', fontWeight: 700, fontSize: '.86rem', color: '#E2E8F0' }}>{ADDITIONAL_GROUP.title}</summary>
            <div className="fg" style={{ marginTop: 10 }}>
              {ADDITIONAL_GROUP.fields.map((f) => (
                <Field key={f.id} label={f.label} full={f.area}>
                  {f.area ? (
                    <textarea className="fi" placeholder={f.placeholder} value={fields[f.id] ?? ''} onChange={(e) => setField(f.id, e.target.value)} />
                  ) : (
                    <input className="fi" placeholder={f.placeholder} value={fields[f.id] ?? ''} onChange={(e) => setField(f.id, e.target.value)} />
                  )}
                </Field>
              ))}
            </div>
          </details>
          <div className="card">
            <Field label="ملاحظات إضافية" full>
              <textarea className="fi" placeholder="أي تفاصيل أخرى تريد إدراجها، خصوصاً إن تركت بعض الحقول الإلزامية فارغة" value={notes} onChange={(e) => setNotes(e.target.value)} />
            </Field>
            <div style={{ marginTop: 12, display: 'flex', gap: 8 }}>
              <button className="dbtn dbtn-p" onClick={generate} disabled={busy}>{busy ? 'جارٍ التوليد...' : '✨ توليد العقد'}</button>
            </div>
            {error && <div style={{ color: '#F87171', fontSize: '.8rem', marginTop: 10 }}>⚠ {error}</div>}
          </div>
        </div>

        <div className="card" style={{ background: 'rgba(255,255,255,.98)', color: '#1E293B', alignSelf: 'flex-start' }}>
          <div style={{ textAlign: 'center', marginBottom: 16 }}>
            <div style={{ fontSize: '1rem', fontWeight: 900 }}>{fields.contract_type || 'العقد'}</div>
            <div style={{ fontSize: '.78rem', color: '#64748B', marginTop: 3 }}>مملكة الأردن الهاشمية</div>
          </div>
          {!result ? (
            <div style={{ fontSize: '.82rem', color: '#64748B', textAlign: 'center', padding: 24 }}>
              عبّئ الحقول الإلزامية (*) على الأقل، ثم اضغط "توليد العقد" — سيظهر النص الفعلي هنا.
            </div>
          ) : (
            <>
              {!result.grounded && (
                <div style={{ fontSize: '.76rem', color: '#B45309', background: 'rgba(245,158,11,.12)', borderRadius: 8, padding: '8px 12px', marginBottom: 10 }}>
                  ⚠️ لم يُعثر على سند قانوني كافٍ لنوع هذا العقد في القاعدة — راجع النص أدناه بعناية خاصة قبل الاستخدام.
                </div>
              )}
              {(result.groundingLevel === 'partial' || (result.unverifiedFacts ?? 0) > 0) && (
                <div style={{ fontSize: '.76rem', color: '#B45309', background: 'rgba(245,158,11,.12)', borderRadius: 8, padding: '8px 12px', marginBottom: 10 }}>
                  ⚠️ تحقّق النظام من المسودة آلياً: حُجبت إسنادات لم تطابق مصادرها
                  {(result.unverifiedFacts ?? 0) > 0 ? `، واستُبدل ${result.unverifiedFacts} من التواريخ/المبالغ/الأرقام التي لم تُدخلها بعلامة [يُستكمل]` : ''}. أكمِلها بنفسك قبل الاستخدام.
                </div>
              )}
              <div style={{ fontSize: '.82rem', lineHeight: 1.9, whiteSpace: 'pre-wrap' }}>{result.draft}</div>
              {result.sources.length > 0 && (
                <div style={{ marginTop: 14, borderTop: '1px solid rgba(0,0,0,.08)', paddingTop: 10 }}>
                  <div style={{ fontSize: '.74rem', color: '#64748B', fontWeight: 700, marginBottom: 6 }}>المصادر ({result.sources.length})</div>
                  {result.sources.map((s) => (
                    <div key={s.ref} style={{ fontSize: '.72rem', color: '#475569', marginBottom: 3 }}>
                      [{s.ref}] {s.lawName || s.title}{s.articleNumber ? ` — المادة ${s.articleNumber}` : ''}
                    </div>
                  ))}
                </div>
              )}
              <div style={{ marginTop: 14, display: 'flex', gap: 8 }}>
                <button className="dbtn dbtn-p" onClick={() => exportFile('docx')} disabled={exporting}>⬇️ Word</button>
                <button className="dbtn dbtn-s" onClick={() => exportFile('pdf')} disabled={exporting}>⬇️ PDF</button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
