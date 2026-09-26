'use client'

import { useEffect, useState } from 'react'
import { apiFetch, errorMessage, fetchAllPages } from '@/lib/dashboard/api-client'
import { Field } from '@/components/dashboard/ui'
import { useDashboard } from '@/components/dashboard/DashboardContext'

export default function AddCaseModal() {
  const { closeModal, notifySuccess } = useDashboard()
  const [clients, setClients] = useState<any[]>([])
  const [lawyers, setLawyers] = useState<any[]>([])
  const [form, setForm] = useState({ number: '', title: '', type: 'مدنية', clientId: '', lawyerId: '', court: '', notes: '' })
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  useEffect(() => {
    // Pickers load EVERY client, not the first page of 200.
    fetchAllPages<any>('/api/clients').then(({ items }) => setClients(items)).catch((e) => setErr(`تعذّر تحميل قائمة العملاء: ${errorMessage(e)}`))
    apiFetch<any[]>('/api/team').then(({ data }) => { if (Array.isArray(data)) setLawyers(data) }).catch((e) => setErr(`تعذّر تحميل قائمة المحامين: ${errorMessage(e)}`))
  }, [])

  const f = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setForm(p => ({ ...p, [k]: e.target.value }))

  async function save() {
    if (!form.number.trim()) return setErr('رقم القضية مطلوب')
    if (!form.title.trim()) return setErr('عنوان القضية مطلوب')
    if (!form.clientId) return setErr('يجب اختيار موكل')
    setBusy(true); setErr('')
    try {
      const res = await fetch('/api/cases', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, lawyerId: form.lawyerId || null }),
      })
      if (!res.ok) { const d = await res.json(); setErr(d.error || 'خطأ في الحفظ'); return }
      notifySuccess()
    } catch { setErr('تعذّر الاتصال بالخادم') } finally { setBusy(false) }
  }

  return (
    <div className="mbox" role="dialog" aria-modal="true" tabIndex={-1}>
      <div className="mt">➕ قضية جديدة <button className="mc" onClick={closeModal} aria-label="إغلاق">✕</button></div>
      <div className="fg">
        <Field label="رقم القضية"><input className="fi" value={form.number} onChange={f('number')} placeholder="2024/XXXX" /></Field>
        <Field label="عنوان القضية"><input className="fi" value={form.title} onChange={f('title')} placeholder="نزاع عمالي — دعوى مدنية..." /></Field>
        <Field label="نوع القضية"><select className="fi" value={form.type} onChange={f('type')}><option>مدنية</option><option>تجارية</option><option>عمالية</option><option>جنائية</option><option>أحوال شخصية</option><option>إدارية</option></select></Field>
        <Field label="الموكل">
          <select className="fi" value={form.clientId} onChange={f('clientId')}>
            <option value="">— اختر موكلاً —</option>
            {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </Field>
        <Field label="المحكمة"><input className="fi" value={form.court} onChange={f('court')} placeholder="بداية عمّان، استئناف عمّان..." /></Field>
        <Field label="المحامي المسؤول">
          <select className="fi" value={form.lawyerId} onChange={f('lawyerId')}>
            <option value="">— اختياري —</option>
            {lawyers.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
        </Field>
        <Field label="ملاحظات" full><textarea className="fi" value={form.notes} onChange={f('notes')} placeholder="وصف موجز للقضية..." /></Field>
      </div>
      {err && <div style={{ color: '#F87171', fontSize: '.8rem', padding: '4px 16px 8px' }}>⚠ {err}</div>}
      <div style={{ marginTop: 14, display: 'flex', gap: 8, padding: '0 16px 16px' }}>
        <button className="dbtn dbtn-p" onClick={save} disabled={busy}>{busy ? 'جارٍ الحفظ...' : '✅ إنشاء القضية'}</button>
        <button className="dbtn dbtn-s" onClick={closeModal}>إلغاء</button>
      </div>
    </div>
  )
}
