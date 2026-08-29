'use client'

import { useEffect, useState } from 'react'
import { Badge, SectionHeader } from '@/components/dashboard/ui'
import { useDashboard } from '@/components/dashboard/DashboardContext'

const SES_STATUS_AR: Record<string, string> = { UPCOMING: 'قادمة', DONE: 'منتهية', POSTPONED: 'مؤجلة' }
const SES_STATUS_BADGE: Record<string, 'ac' | 'cl' | 'pe'> = { UPCOMING: 'ac', DONE: 'cl', POSTPONED: 'pe' }

export default function SessionsPage() {
  const { openModal, refreshKey } = useDashboard()
  const [sessions, setSessions] = useState<any[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    // No synchronous setLoading(true) (react-hooks/set-state-in-effect):
    // useState(true) covers first load; a refetch updates in place.
    fetch('/api/sessions').then(r => r.json()).then(d => { if (Array.isArray(d)) setSessions(d) }).catch(() => {}).finally(() => setLoading(false))
  }, [refreshKey])

  const upcoming = sessions.filter(s => s.status === 'UPCOMING')

  return (
    <div className="pg">
      <SectionHeader title="إدارة الجلسات" subtitle={`${upcoming.length} جلسة قادمة`}>
        <button className="dbtn dbtn-p" onClick={() => openModal('m-add-session')}>+ جلسة جديدة</button>
      </SectionHeader>
      {loading ? <div style={{ padding: 32, textAlign: 'center', color: '#94A3B8' }}>جارٍ التحميل...</div> : (
        <div className="card">
          <div className="ct">📋 الجلسات</div>
          <table className="dt">
            <tbody>
              <tr><th>التاريخ</th><th>الوقت</th><th>القضية</th><th>الموكل</th><th>المحكمة</th><th>القاضي</th><th>الحالة</th><th /></tr>
              {sessions.map((s) => (
                <tr key={s.id}>
                  <td><b>{new Date(s.date).toLocaleDateString('ar-JO')}</b></td>
                  <td>{s.time}</td>
                  <td>{s.case.number}</td>
                  <td>{s.case.client.name}</td>
                  <td>{s.court}</td>
                  <td>{s.judge ?? '—'}</td>
                  <td><Badge type={SES_STATUS_BADGE[s.status]}>{SES_STATUS_AR[s.status]}</Badge></td>
                  <td><button className="dbtn dbtn-s" style={{ padding: '4px 10px', fontSize: '.72rem' }} onClick={() => openModal('m-edit-session', { sessionId: s.id })}>✏️ تعديل</button></td>
                </tr>
              ))}
              {sessions.length === 0 && <tr><td colSpan={8} style={{ textAlign: 'center', color: '#94A3B8', padding: 24 }}>لا توجد جلسات</td></tr>}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
