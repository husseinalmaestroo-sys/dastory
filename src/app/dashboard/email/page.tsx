'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Field, SectionHeader } from '@/components/dashboard/ui'
import { useDashboard } from '@/components/dashboard/DashboardContext'

export default function EmailPage() {
  const router = useRouter()
  const { openModal } = useDashboard()
  const [to, setTo] = useState('')
  const [emailSubject, setEmailSubject] = useState('')
  const [body, setBody] = useState('')
  const [sending, setSending] = useState(false)
  const [sendMsg, setSendMsg] = useState('')
  const [sendError, setSendError] = useState('')

  const send = async () => {
    setSending(true); setSendMsg(''); setSendError('')
    try {
      const res = await fetch('/api/email/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to, subject: emailSubject, body }),
      })
      const data = await res.json()
      if (!res.ok) setSendError(data.error || 'فشل الإرسال')
      else { setSendMsg('✅ تم إرسال الرسالة بنجاح'); setTo(''); setEmailSubject(''); setBody('') }
    } catch { setSendError('تعذّر الاتصال بالخادم') }
    finally { setSending(false) }
  }

  const loadDraft = (from: string, subj: string) => {
    setTo(''); setEmailSubject(`رداً: ${subj}`); setBody(`أخي / أختي ${from}،\n\nتحية طيبة وبعد،\n\n`)
  }

  return (
    <div className="pg">
      <SectionHeader title="البريد الإلكتروني" subtitle="الرسائل الواردة">
        <button className="dbtn dbtn-p" onClick={() => openModal('m-compose')}>✉️ رسالة جديدة</button>
      </SectionHeader>
      <div className="g2">
        <div className="card">
          <div className="ct">📥 الوارد</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {([
              ['نادين الخطيب', '10:23 ص', 'موعد جلسة قضية 2024/1701 — تأجيل إلى الأسبوع القادم', true],
              ['مجموعة النور', 'أمس', 'مراجعة العقد الجديد — مرفق للاطلاع والملاحظة', true],
              ['أحمد المصري', 'أمس', 'استفسار عن موعد جلسة الاستئناف القادمة', true],
              ['نقابة المحامين', 'الاثنين', 'إشعار تجديد اشتراك النقابة لعام 2026', false],
            ] as [string, string, string, boolean][]).map(([from, time, bodyText, unread]) => (
              <div key={from} onClick={() => loadDraft(from, bodyText)} style={{ padding: 10, background: unread ? 'rgba(37,99,235,.07)' : 'rgba(255,255,255,.03)', border: unread ? '1px solid rgba(37,99,235,.15)' : 'none', borderRadius: 9, cursor: 'pointer' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                  <b style={{ fontSize: '.82rem', color: unread ? '#E2E8F0' : '#94A3B8' }}>{from}</b>
                  <span style={{ fontSize: '.7rem', color: '#64748B' }}>{time}</span>
                </div>
                <div style={{ fontSize: '.78rem', color: unread ? '#94A3B8' : '#64748B' }}>{bodyText}</div>
              </div>
            ))}
          </div>
        </div>
        <div className="card">
          <div className="ct">✉️ إنشاء رسالة</div>
          <div className="fg" style={{ marginBottom: 12 }}>
            <Field label="إلى" full><input className="fi" value={to} onChange={e => setTo(e.target.value)} placeholder="email@example.com" /></Field>
            <Field label="الموضوع" full><input className="fi" value={emailSubject} onChange={e => setEmailSubject(e.target.value)} placeholder="موضوع الرسالة" /></Field>
            <Field label="الرسالة" full><textarea className="fi" style={{ minHeight: 130 }} value={body} onChange={e => setBody(e.target.value)} placeholder="اكتب رسالتك هنا..." /></Field>
          </div>
          {sendMsg && <div style={{ color: '#10B981', fontSize: '.82rem', marginBottom: 8 }}>{sendMsg}</div>}
          {sendError && <div style={{ color: '#F87171', fontSize: '.82rem', marginBottom: 8 }}>⚠️ {sendError}</div>}
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="dbtn dbtn-p" onClick={send} disabled={sending || !to || !emailSubject || !body}>
              {sending ? 'جارٍ الإرسال...' : '📤 إرسال'}
            </button>
            <button className="dbtn dbtn-s" onClick={() => router.push('/dashboard/documents')}>📎 إرفاق ملف</button>
          </div>
          <div style={{ marginTop: 10, fontSize: '.74rem', color: '#64748B', background: 'rgba(255,255,255,.03)', borderRadius: 8, padding: '8px 12px' }}>
            💡 لإرسال رسائل حقيقية: أضف SMTP_HOST، SMTP_USER، SMTP_PASS في ملف .env — راجع .env.example
          </div>
        </div>
      </div>
    </div>
  )
}
