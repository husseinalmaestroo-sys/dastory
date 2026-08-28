'use client'

import { useEffect, useState } from 'react'
import { Field } from '@/components/dashboard/ui'
import { useDashboard } from '@/components/dashboard/DashboardContext'

export default function EditInvoiceModal({ invoiceId }: { invoiceId?: string }) {
  const { closeModal, notifySuccess } = useDashboard()
  const [loading, setLoading] = useState(true)
  const [form, setForm] = useState({ amount: '', paid: '', status: 'UNPAID', dueDate: '', notes: '' })
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  useEffect(() => {
    if (!invoiceId) { setLoading(false); return }
    fetch('/api/invoices').then(r => r.json()).then(d => {
      const inv = Array.isArray(d) ? d.find((item: any) => item.id === invoiceId) : null
      if (inv) {
        setForm({
          amount: String(inv.amount), paid: String(inv.paid), status: inv.status,
          dueDate: inv.dueDate ? new Date(inv.dueDate).toISOString().slice(0, 10) : '', notes: inv.notes ?? '',
        })
      }
    }).catch(() => {}).finally(() => setLoading(false))
  }, [invoiceId])

  const f = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setForm(p => ({ ...p, [k]: e.target.value }))

  async function save() {
    const amount = Number(form.amount); const paid = Number(form.paid)
    if (!Number.isFinite(amount) || amount <= 0) return setErr('المبلغ غير صحيح')
    if (!Number.isFinite(paid) || paid < 0) return setErr('المبلغ المدفوع غير صحيح')
    if (paid > amount) return setErr('المبلغ المدفوع لا يمكن أن يتجاوز مبلغ الفاتورة')
    setBusy(true); setErr('')
    try {
      const res = await fetch(`/api/invoices/${invoiceId}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount, paid, status: form.status, dueDate: form.dueDate || null, notes: form.notes || null }),
      })
      if (!res.ok) { const d = await res.json(); setErr(d.error || 'خطأ في الحفظ'); return }
      notifySuccess()
    } catch { setErr('تعذّر الاتصال بالخادم') } finally { setBusy(false) }
  }

  async function del() {
    if (!window.confirm('هل أنت متأكد من حذف هذه الفاتورة؟')) return
    setBusy(true); setErr('')
    try {
      const res = await fetch(`/api/invoices/${invoiceId}`, { method: 'DELETE' })
      if (!res.ok) { const d = await res.json(); setErr(d.error || 'تعذّر الحذف'); return }
      notifySuccess()
    } catch { setErr('تعذّر الاتصال بالخادم') } finally { setBusy(false) }
  }

  if (loading) return <div className="mbox" role="dialog" aria-modal="true" tabIndex={-1}><div style={{ padding: 24, textAlign: 'center', color: '#94A3B8' }}>جارٍ التحميل...</div></div>

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
