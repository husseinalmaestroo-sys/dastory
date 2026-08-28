'use client'

import { Field } from '@/components/dashboard/ui'
import { useDashboard } from '@/components/dashboard/DashboardContext'

export default function ComposeModal() {
  const { closeModal } = useDashboard()
  return (
    <div className="mbox" role="dialog" aria-modal="true" tabIndex={-1}>
      <div className="mt">✉️ رسالة جديدة <button className="mc" onClick={closeModal} aria-label="إغلاق">✕</button></div>
      <div className="fg">
        <Field label="إلى" full><input className="fi" placeholder="البريد الإلكتروني" /></Field>
        <Field label="الموضوع" full><input className="fi" placeholder="موضوع الرسالة" /></Field>
        <Field label="الرسالة" full><textarea className="fi" style={{ minHeight: 100 }} /></Field>
      </div>
      <div style={{ marginTop: 14, display: 'flex', gap: 8 }}>
        <button className="dbtn dbtn-p" onClick={() => { closeModal(); window.alert('تم الإرسال') }}>📤 إرسال</button>
        <button className="dbtn dbtn-s" onClick={closeModal}>إلغاء</button>
      </div>
    </div>
  )
}
