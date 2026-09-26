'use client'

import { useState } from 'react'
import { Badge, ErrorState, LoadMore, SectionHeader } from '@/components/dashboard/ui'
import { useDashboard } from '@/components/dashboard/DashboardContext'
import { usePaginatedList } from '@/components/dashboard/usePaginatedList'

const SES_STATUS_AR: Record<string, string> = { UPCOMING: 'قادمة', DONE: 'منتهية', POSTPONED: 'مؤجلة' }
const SES_STATUS_BADGE: Record<string, 'ac' | 'cl' | 'pe'> = { UPCOMING: 'ac', DONE: 'cl', POSTPONED: 'pe' }

// Start of today — "upcoming" includes the rest of today.
function todayIso() {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return d.toISOString()
}

export default function SessionsPage() {
  const { openModal, refreshKey } = useDashboard()
  const [tab, setTab] = useState<'upcoming' | 'past'>('upcoming')
  const [today] = useState(todayIso)
  // Upcoming: soonest first. Past: most recent first. Both paginate through
  // the API, so every session is reachable (the old page loaded only the 200
  // OLDEST sessions and never showed anything newer).
  const url = tab === 'upcoming'
    ? `/api/sessions?from=${encodeURIComponent(today)}&order=asc`
    : `/api/sessions?to=${encodeURIComponent(today)}&order=desc`
  const list = usePaginatedList<any>(url, refreshKey)

  return (
    <div className="pg">
      <SectionHeader title="إدارة الجلسات" subtitle={list.total !== null ? `${list.total} جلسة ${tab === 'upcoming' ? 'قادمة' : 'سابقة'}` : ''}>
        <button className="dbtn dbtn-p" onClick={() => openModal('m-add-session')}>+ جلسة جديدة</button>
      </SectionHeader>
      <div style={{ display: 'flex', gap: 9, marginBottom: 16 }}>
        {([['upcoming', 'القادمة'], ['past', 'السابقة']] as const).map(([key, label]) => (
          <button key={key} onClick={() => setTab(key)} className="dbtn" style={{ background: tab === key ? 'var(--gold)' : 'rgba(255,255,255,.06)', color: tab === key ? '#0F172A' : '#94A3B8', border: 'none', padding: '5px 14px', borderRadius: 20, fontSize: '.78rem', fontWeight: 700, cursor: 'pointer' }}>{label}</button>
        ))}
      </div>
      {list.loading ? <div style={{ padding: 32, textAlign: 'center', color: '#94A3B8' }}>جارٍ التحميل...</div> : list.error && list.items.length === 0 ? (
        <ErrorState message={list.error} onRetry={list.retry} />
      ) : (
        <div className="card">
          <div className="ct">📋 الجلسات</div>
          <table className="dt">
            <tbody>
              <tr><th>التاريخ</th><th>الوقت</th><th>القضية</th><th>الموكل</th><th>المحكمة</th><th>القاضي</th><th>الحالة</th><th /></tr>
              {list.items.map((s) => (
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
              {list.items.length === 0 && <tr><td colSpan={8} style={{ textAlign: 'center', color: '#94A3B8', padding: 24 }}>لا توجد جلسات</td></tr>}
            </tbody>
          </table>
          {list.error && <ErrorState message={list.error} onRetry={list.loadMore} />}
          <LoadMore shown={list.items.length} total={list.total} hasMore={list.hasMore} loading={list.loadingMore} onClick={list.loadMore} />
        </div>
      )}
    </div>
  )
}
