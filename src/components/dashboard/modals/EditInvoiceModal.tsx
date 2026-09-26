'use client'

import { useEffect, useState } from 'react'
import { Field } from '@/components/dashboard/ui'
import { useDashboard } from '@/components/dashboard/DashboardContext'
import { apiFetch, errorMessage } from '@/lib/dashboard/api-client'

// Up to 3 decimal places (JOD fils) — sent to the API as the decimal string
// typed, never through float arithmetic.
const MONEY_RE = /^\d+(\.\d{1,3})?$/

export default function EditInvoiceModal({ invoiceId }: { invoiceId?: string }) {
  const { closeModal, notifySuccess } = useDashboard()
  // Start false when there's nothing to fetch — replaces a synchronous
  // setLoading(false) in the effect guard (react-hooks/set-state-in-effect).
  const [loading, setLoading] = useState(!!invoiceId)
  const [form, setForm] = useState({ amount: '', paid: '', status: 'UNPAID', dueDate: '', notes: '' })
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [loadErr, setLoadErr] = useState('')

  // Fetched by id — the old modal searched the first page of /api/invoices,
  // so any invoice past row 200 opened as an empty form that could be saved.
  useEffect(() => {
    if (!invoiceId) return
    let cancelled = false
    apiFetch<any>(`/api/invoices/${invoiceId}`)
      .then(({ data: inv }) => {
        if (cancelled) return
        setForm({
          amount: String(inv.amount), paid: String(inv.paid), status: inv.status,
          dueDate: inv.dueDate ? new Date(inv.dueDate).toISOString().slice(0, 10) : '', notes: inv.notes ?? '',
        })
      })
      .catch((e) => { if (!cancelled) setLoadErr(errorMessage(e)) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [invoiceId])

  const f = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const value = e.target.value
    // "Paid" means paid in full: fill the paid amount so the (server-
    // validated) status and amounts agree.
    setForm(p => (k === 'status' && value === 'PAID' ? { ...p, status: value, paid: p.amount } : { ...p, [k]: value }))
  }

  async function save() {
    const amount = form.amount.trim(); const paid = form.paid.trim() || '0'
    if (!MONEY_RE.test(amount) || Number(amount) <= 0) return setErr('المبلغ غير صحيح (ثلاث منازل عشرية كحد أقصى)')
    if (!MONEY_RE.test(paid)) return setErr('المبلغ المدفوع غير صحيح (ثلاث منازل عشرية كحد أقصى)')
    setBusy(true); setErr('')
    try {
      await apiFetch(`/api/invoices/${invoiceId}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount, paid, status: form.status, dueDate: form.dueDate || null, notes: form.notes || null }),
      })
      notifySuccess()
    } catch (e) { setErr(errorMessage(e)) } finally { setBusy(false) }
  }

  async function del() {
    if (!window.confirm('هل أنت متأكد من حذف هذه الفاتورة؟')) return
    setBusy(true); setErr('')
    try {
      await apiFetch(`/api/invoices/${invoiceId}`, { method: 'DELETE' })
      notifySuccess()
    } catch (e) { setErr(errorMessage(e)) } finally { setBusy(false) }
  }

  if (loading) return <div className="mbox" role="dialog" aria-modal="true" tabIndex={-1}><div style={{ padding: 24, textAlign: 'center', color: '#94A3B8' }}>جارٍ التحميل...</div></div>
  if (loadErr) return <div className="mbox" role="dialog" aria-modal="true" tabIndex={-1}><div className="mt">✏️ تعديل الفاتورة <button className="mc" onClick={closeModal} aria-label="إغلاق">✕</button></div><div role="alert" style={{ padding: 24, textAlign: 'center', color: '#FCA5A5' }}>⚠️ {loadErr}</div></div>

  return (
    <div className="mbox" role="dialog" aria-modal="true" tabIndex={-1}>
      <div className="mt">✏️ تعديل الفاتورة <button className="mc" onClick={closeModal} aria-label="إغلاق">✕</button></div>
      <div className="fg">
        <Field label="المبلغ (د.أ)"><input className="fi" type="number" value={form.amount} onChange={f('amount')} /></Field>
        <Field label="المبلغ المدفوع (د.أ)"><input className="fi" type="number" value={form.paid} onChange={f('paid')} /></Field>
        <Field label="الحالة">
          <select className="fi" value={form.status} onChange={f('status')}>
            <option value="UNPAID">غير مدفوعة</option>
            <option value="PARTIAL">جزئي</option>
            <option value="PAID">مدفوعة</option>
            <option value="OVERDUE">متأخرة</option>
          </select>
        </Field>
        <Field label="تاريخ الاستحقاق"><input className="fi" type="date" value={form.dueDate} onChange={f('dueDate')} /></Field>
        <Field label="ملاحظات" full><textarea className="fi" value={form.notes} onChange={f('notes')} /></Field>
      </div>
      {err && <div style={{ color: '#F87171', fontSize: '.8rem', padding: '4px 16px 8px' }}>⚠ {err}</div>}
      <div style={{ marginTop: 14, display: 'flex', gap: 8, padding: '0 16px 16px' }}>
        <button className="dbtn dbtn-p" onClick={save} disabled={busy}>{busy ? 'جارٍ الحفظ...' : '✅ حفظ التعديلات'}</button>
        <button className="dbtn dbtn-s" onClick={closeModal}>إلغاء</button>
        <button className="dbtn dbtn-d" style={{ marginRight: 'auto' }} onClick={del} disabled={busy}>🗑️ حذف</button>
      </div>
    </div>
  )
}
