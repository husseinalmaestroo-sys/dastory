'use client'

import { useState } from 'react'
import { Badge, ErrorState, LoadMore, SectionHeader } from '@/components/dashboard/ui'
import { useDashboard } from '@/components/dashboard/DashboardContext'
import { usePaginatedList } from '@/components/dashboard/usePaginatedList'

const CASE_STATUS_AR: Record<string, string> = { ACTIVE: 'نشطة', CLOSED: 'مغلقة', SUSPENDED: 'معلقة', PENDING: 'قيد الانتظار' }
const CASE_STATUS_BADGE: Record<string, 'ac' | 'cl' | 'pe' | 'ur'> = { ACTIVE: 'ac', CLOSED: 'cl', SUSPENDED: 'pe', PENDING: 'ur' }

export default function CasesPage() {
  const { openModal, refreshKey } = useDashboard()
  const [filter, setFilter] = useState('ALL')
  // The status filter is applied by the API, so it covers every case — not
  // just the rows already loaded in the browser.
  const list = usePaginatedList<any>(filter === 'ALL' ? '/api/cases' : `/api/cases?status=${filter}`, refreshKey)

  return (
    <div className="pg">
      <SectionHeader title="إدارة القضايا" subtitle={list.total !== null ? `${list.total} قضية${filter === 'ALL' ? '' : ` — ${CASE_STATUS_AR[filter]}`}` : ''}>
        <button className="dbtn dbtn-p" onClick={() => openModal('m-add-case')}>+ قضية جديدة</button>
      </SectionHeader>
      <div style={{ display: 'flex', gap: 9, marginBottom: 16, flexWrap: 'wrap' }}>
        {['ALL', 'ACTIVE', 'SUSPENDED', 'CLOSED', 'PENDING'].map(s => (
          <button key={s} onClick={() => setFilter(s)} className="dbtn" style={{ background: filter === s ? 'var(--gold)' : 'rgba(255,255,255,.06)', color: filter === s ? '#0F172A' : '#94A3B8', border: 'none', padding: '5px 14px', borderRadius: 20, fontSize: '.78rem', fontWeight: 700, cursor: 'pointer' }}>
            {s === 'ALL' ? 'الكل' : CASE_STATUS_AR[s]}
          </button>
        ))}
      </div>
      <div className="card">
        {list.loading ? <div style={{ padding: 32, textAlign: 'center', color: '#94A3B8' }}>جارٍ التحميل...</div> : list.error && list.items.length === 0 ? (
          <ErrorState message={list.error} onRetry={list.retry} />
        ) : (
          <>
            <table className="dt">
              <tbody>
                <tr><th>رقم القضية</th><th>العنوان</th><th>النوع</th><th>الموكل</th><th>المحكمة</th><th>المحامي</th><th>الجلسات</th><th>الحالة</th><th /></tr>
                {list.items.map((c) => (
                  <tr key={c.id}>
                    <td><b>{c.number}</b></td>
                    <td>{c.title}</td>
                    <td>{c.type}</td>
                    <td>{c.client.name}</td>
                    <td>{c.court ?? '—'}</td>
                    <td>{c.lawyer?.name ?? '—'}</td>
                    <td><Badge type="bl">{c._count.sessions}</Badge></td>
                    <td><Badge type={CASE_STATUS_BADGE[c.status]}>{CASE_STATUS_AR[c.status]}</Badge></td>
                    <td><button className="dbtn dbtn-s" style={{ padding: '4px 9px', fontSize: '.7rem' }} onClick={() => openModal('m-case-detail', { caseId: c.id })}>تفاصيل</button></td>
                  </tr>
                ))}
                {list.items.length === 0 && <tr><td colSpan={9} style={{ textAlign: 'center', color: '#94A3B8', padding: 24 }}>لا توجد قضايا</td></tr>}
              </tbody>
            </table>
            {list.error && <ErrorState message={list.error} onRetry={list.loadMore} />}
            <LoadMore shown={list.items.length} total={list.total} hasMore={list.hasMore} loading={list.loadingMore} onClick={list.loadMore} />
          </>
        )}
      </div>
    </div>
  )
}
