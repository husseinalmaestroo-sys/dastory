'use client'

import { useState } from 'react'
import { Field } from '@/components/dashboard/ui'
import { useDashboard } from '@/components/dashboard/DashboardContext'

export default function AddClientModal() {
  const { closeModal, notifySuccess } = useDashboard()
  const [form, setForm] = useState({ name: '', phone: '', email: '', idNumber: '', address: '' })
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  const f = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setForm(p => ({ ...p, [k]: e.target.value }))

  async function save() {
    if (!form.name.trim()) return setErr('اسم العميل مطلوب')
    setBusy(true); setErr('')
    try {
      const res = await fetch('/api/clients', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })
      if (!res.ok) { const d = await res.json(); setErr(d.error || 'خطأ في الحفظ'); return }
      notifySuccess()
    } catch { setErr('تعذّر الاتصال بالخادم') } finally { setBusy(false) }
  }

  return (
    <div className="mbox" role="dialog" aria-modal="true" tabIndex={-1}>
      <div className="mt">➕ عميل جديد <button className="mc" onClick={closeModal} aria-label="إغلاق">✕</button></div>
      <div className="fg">
        <Field label="اسم العميل / الشركة"><input className="fi" value={form.name} onChange={f('name')} placeholder="الاسم الكامل" /></Field>
        <Field label="رقم الهاتف"><input className="fi" value={form.phone} onChange={f('phone')} placeholder="07X XXXX XXXX" /></Field>
        <Field label="البريد الإلكتروني"><input className="fi" type="email" value={form.email} onChange={f('email')} placeholder="email@domain.com" /></Field>
        <Field label="رقم الهوية / السجل التجاري"><input className="fi" value={form.idNumber} onChange={f('idNumber')} placeholder="XXXXXXXXX" /></Field>
        <Field label="العنوان" full><input className="fi" value={form.address} onChange={f('address')} placeholder="عمّان، شارع..." /></Field>
      </div>
      {err && <div style={{ color: '#F87171', fontSize: '.8rem', padding: '4px 16px 8px' }}>⚠ {err}</div>}
      <div style={{ marginTop: 14, display: 'flex', gap: 8, padding: '0 16px 16px' }}>
        <button className="dbtn dbtn-p" onClick={save} disabled={busy}>{busy ? 'جارٍ الحفظ...' : '✅ إضافة العميل'}</button>
        <button className="dbtn dbtn-s" onClick={closeModal}>إلغاء</button>
      </div>
    </div>
  )
}
