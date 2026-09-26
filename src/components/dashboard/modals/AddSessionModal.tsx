'use client'

import { useEffect, useState } from 'react'
import { apiFetch, errorMessage, fetchAllPages } from '@/lib/dashboard/api-client'
import { Field } from '@/components/dashboard/ui'
import { useDashboard } from '@/components/dashboard/DashboardContext'

export default function AddSessionModal() {
  const { closeModal, notifySuccess } = useDashboard()
  const [cases, setCases] = useState<any[]>([])
  const [form, setForm] = useState({ caseId: '', date: '', time: '09:30', court: '', judge: '', notes: '' })
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  useEffect(() => {
    // Picker loads EVERY case, not the first page of 200.
    fetchAllPages<any>('/api/cases').then(({ items }) => setCases(items)).catch((e) => setErr(`تعذّر تحميل قائمة القضايا: ${errorMessage(e)}`))
  }, [])

  const f = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setForm(p => ({ ...p, [k]: e.target.value }))

  // One key per opened form — a double-click can't create two sessions.
  const [idempotencyKey] = useState(() => crypto.randomUUID())

  async function save() {
    if (!form.caseId) return setErr('يجب اختيار القضية')
    if (!form.date) return setErr('تاريخ الجلسة مطلوب')
    setBusy(true); setErr('')
    try {
      await apiFetch('/api/sessions', {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey },
        body: JSON.stringify({ ...form, judge: form.judge || null, notes: form.notes || null }),
      })
      notifySuccess()
    } catch (e) { setErr(errorMessage(e)) } finally { setBusy(false) }
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
