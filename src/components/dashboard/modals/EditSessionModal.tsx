'use client'

import { useEffect, useState } from 'react'
import { Field } from '@/components/dashboard/ui'
import { useDashboard } from '@/components/dashboard/DashboardContext'

export default function EditSessionModal({ sessionId }: { sessionId?: string }) {
  const { closeModal, notifySuccess } = useDashboard()
  // Start false when there's nothing to fetch — replaces a synchronous
  // setLoading(false) in the effect guard (react-hooks/set-state-in-effect).
  const [loading, setLoading] = useState(!!sessionId)
  const [form, setForm] = useState({ date: '', time: '', court: '', judge: '', status: 'UPCOMING', notes: '' })
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  useEffect(() => {
    if (!sessionId) return
    fetch('/api/sessions').then(r => r.json()).then(d => {
      const s = Array.isArray(d) ? d.find((item: any) => item.id === sessionId) : null
      if (s) {
        setForm({
          date: new Date(s.date).toISOString().slice(0, 10),
          time: s.time, court: s.court, judge: s.judge ?? '', status: s.status, notes: s.notes ?? '',
        })
      }
    }).catch(() => {}).finally(() => setLoading(false))
  }, [sessionId])

  const f = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setForm(p => ({ ...p, [k]: e.target.value }))

  async function save() {
    if (!form.date || !form.time || !form.court.trim()) return setErr('التاريخ والوقت والمحكمة مطلوبة')
    setBusy(true); setErr('')
    try {
      const res = await fetch(`/api/sessions/${sessionId}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, judge: form.judge || null, notes: form.notes || null }),
      })
      if (!res.ok) { const d = await res.json(); setErr(d.error || 'خطأ في الحفظ'); return }
      notifySuccess()
    } catch { setErr('تعذّر الاتصال بالخادم') } finally { setBusy(false) }
  }

  async function del() {
    if (!window.confirm('هل أنت متأكد من حذف هذه الجلسة؟')) return
    setBusy(true); setErr('')
    try {
      const res = await fetch(`/api/sessions/${sessionId}`, { method: 'DELETE' })
      if (!res.ok) { const d = await res.json(); setErr(d.error || 'تعذّر الحذف'); return }
      notifySuccess()
    } catch { setErr('تعذّر الاتصال بالخادم') } finally { setBusy(false) }
  }

  if (loading) return <div className="mbox" role="dialog" aria-modal="true" tabIndex={-1}><div style={{ padding: 24, textAlign: 'center', color: '#94A3B8' }}>جارٍ التحميل...</div></div>

  return (
    <div className="mbox" role="dialog" aria-modal="true" tabIndex={-1}>
      <div className="mt">✏️ تعديل الجلسة <button className="mc" onClick={closeModal} aria-label="إغلاق">✕</button></div>
      <div className="fg">
        <Field label="تاريخ الجلسة"><input className="fi" type="date" value={form.date} onChange={f('date')} /></Field>
        <Field label="الوقت"><input className="fi" type="time" value={form.time} onChange={f('time')} /></Field>
        <Field label="المحكمة"><input className="fi" value={form.court} onChange={f('court')} /></Field>
        <Field label="القاضي"><input className="fi" value={form.judge} onChange={f('judge')} placeholder="اختياري" /></Field>
        <Field label="الحالة">
          <select className="fi" value={form.status} onChange={f('status')}>
            <option value="UPCOMING">قادمة</option>
            <option value="DONE">منتهية</option>
            <option value="POSTPONED">مؤجلة</option>
          </select>
        </Field>
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
