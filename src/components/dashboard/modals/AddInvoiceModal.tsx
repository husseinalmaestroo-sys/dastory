'use client'

import { useEffect, useState } from 'react'
import { apiFetch, errorMessage, fetchAllPages } from '@/lib/dashboard/api-client'
import { Field } from '@/components/dashboard/ui'
import { useDashboard } from '@/components/dashboard/DashboardContext'

export default function AddInvoiceModal() {
  const { closeModal, notifySuccess } = useDashboard()
  const [clients, setClients] = useState<any[]>([])
  const [cases, setCases] = useState<any[]>([])
  const [form, setForm] = useState({ number: '', clientId: '', caseId: '', notes: '', amount: '', dueDate: '' })
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  useEffect(() => {
    // Pickers load EVERY client/case, not the first page of 200.
    fetchAllPages<any>('/api/clients').then(({ items }) => setClients(items)).catch((e) => setErr(`تعذّر تحميل قائمة العملاء: ${errorMessage(e)}`))
    fetchAllPages<any>('/api/cases').then(({ items }) => setCases(items)).catch((e) => setErr(`تعذّر تحميل قائمة القضايا: ${errorMessage(e)}`))
  }, [])

  const f = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setForm(p => ({ ...p, [k]: e.target.value }))

  const clientCases = cases.filter(c => !form.clientId || c.clientId === form.clientId)
  // One key per opened form: a double-click or network retry of the same
  // submission is de-duplicated by the API (src/lib/idempotency.ts).
  const [idempotencyKey] = useState(() => crypto.randomUUID())

  async function save() {
    if (!form.clientId) return setErr('يجب اختيار العميل')
    const amount = form.amount.trim()
    // Up to 3 decimals (JOD fils); sent as the typed decimal string.
    if (!/^\d+(\.\d{1,3})?$/.test(amount) || Number(amount) <= 0) return setErr('المبلغ غير صحيح (ثلاث منازل عشرية كحد أقصى)')
    setBusy(true); setErr('')
    const number = form.number.trim() || `INV-${Date.now()}`
    try {
      await apiFetch('/api/invoices', {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey },
        body: JSON.stringify({ ...form, number, amount, caseId: form.caseId || null, dueDate: form.dueDate || null, notes: form.notes || null }),
      })
      notifySuccess()
    } catch (e) { setErr(errorMessage(e)) } finally { setBusy(false) }
  }

  return (
    <div className="mbox" role="dialog" aria-modal="true" tabIndex={-1}>
      <div className="mt">🧾 فاتورة جديدة <button className="mc" onClick={closeModal} aria-label="إغلاق">✕</button></div>
      <div className="fg">
        <Field label="رقم الفاتورة"><input className="fi" value={form.number} onChange={f('number')} placeholder="INV-2024-XXX (يُولَّد تلقائياً)" /></Field>
        <Field label="العميل">
          <select className="fi" value={form.clientId} onChange={e => { setForm(p => ({ ...p, clientId: e.target.value, caseId: '' })) }}>
            <option value="">— اختر العميل —</option>
            {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </Field>
        <Field label="القضية (اختياري)">
          <select className="fi" value={form.caseId} onChange={f('caseId')}>
            <option value="">—</option>
            {clientCases.map(c => <option key={c.id} value={c.id}>{c.number} — {c.title}</option>)}
          </select>
        </Field>
        <Field label="وصف الخدمة" full><input className="fi" value={form.notes} onChange={f('notes')} placeholder="أتعاب قانونية — جلسة مرافعة" /></Field>
        <Field label="المبلغ (د.أ)"><input className="fi" type="number" value={form.amount} onChange={f('amount')} placeholder="0.000" /></Field>
        <Field label="تاريخ الاستحقاق"><input className="fi" type="date" value={form.dueDate} onChange={f('dueDate')} /></Field>
      </div>
      {err && <div style={{ color: '#F87171', fontSize: '.8rem', padding: '4px 16px 8px' }}>⚠ {err}</div>}
      <div style={{ marginTop: 14, display: 'flex', gap: 8, padding: '0 16px 16px' }}>
        <button className="dbtn dbtn-p" onClick={save} disabled={busy}>{busy ? 'جارٍ الحفظ...' : '✅ إصدار الفاتورة'}</button>
        <button className="dbtn dbtn-s" onClick={closeModal}>إلغاء</button>
      </div>
    </div>
  )
}
