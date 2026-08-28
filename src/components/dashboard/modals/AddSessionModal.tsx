'use client'

import { useEffect, useState } from 'react'
import { Field } from '@/components/dashboard/ui'
import { useDashboard } from '@/components/dashboard/DashboardContext'

export default function AddSessionModal() {
  const { closeModal, notifySuccess } = useDashboard()
  const [cases, setCases] = useState<any[]>([])
  const [form, setForm] = useState({ caseId: '', date: '', time: '09:30', court: '', judge: '', notes: '' })
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  useEffect(() => {
    fetch('/api/cases').then(r => r.json()).then(d => { if (Array.isArray(d)) setCases(d) }).catch(() => {})
  }, [])

  const f = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setForm(p => ({ ...p, [k]: e.target.value }))

  async function save() {
    if (!form.caseId) return setErr('يجب اختيار القضية')
    if (!form.date) return setErr('تاريخ الجلسة مطلوب')
    setBusy(true); setErr('')
    try {
      const res = await fetch('/api/sessions', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, judge: form.judge || null, notes: form.notes || null }),
      })
      if (!res.ok) { const d = await res.json(); setErr(d.error || 'خطأ في الحفظ'); return }
      notifySuccess()
    } catch { setErr('تعذّر الاتصال بالخادم') } finally { setBusy(false) }
  }

  return (
    <div className="mbox" role="dialog" aria-modal="true" tabIndex={-1}>
      <div className="mt">📅 جلسة جديدة <button className="mc" onClick={closeModal} aria-label="إغلاق">✕</button></div>
      <div className="fg">
        <Field label="القضية" full>
          <select className="fi" value={form.caseId} onChange={f('caseId')}>
            <option value="">— اختر القضية —</option>
            {cases.map(c => <option key={c.id} value={c.id}>{c.number} — {c.title}</option>)}
          </select>
        </Field>
        <Field label="تاريخ الجلسة"><input className="fi" type="date" value={form.date} onChange={f('date')} /></Field>
        <Field label="الوقت"><input className="fi" type="time" value={form.time} onChange={f('time')} /></Field>
        <Field label="المحكمة"><input className="fi" value={form.court} onChange={f('court')} placeholder="بداية عمّان، استئناف عمّان..." /></Field>
        <Field label="القاضي"><input className="fi" value={form.judge} onChange={f('judge')} placeholder="اسم القاضي (اختياري)" /></Field>
        <Field label="ملاحظات" full><textarea className="fi" value={form.notes} onChange={f('notes')} placeholder="ملاحظات إضافية..." /></Field>
      </div>
      {err && <div style={{ color: '#F87171', fontSize: '.8rem', padding: '4px 16px 8px' }}>⚠ {err}</div>}
      <div style={{ marginTop: 14, display: 'flex', gap: 8, padding: '0 16px 16px' }}>
        <button className="dbtn dbtn-p" onClick={save} disabled={busy}>{busy ? 'جارٍ الحفظ...' : '✅ حفظ الجلسة'}</button>
        <button className="dbtn dbtn-s" onClick={closeModal}>إلغاء</button>
      </div>
    </div>
  )
}
