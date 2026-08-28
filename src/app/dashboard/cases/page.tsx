'use client'

import { useEffect, useState } from 'react'
import { Badge, SectionHeader } from '@/components/dashboard/ui'
import { useDashboard } from '@/components/dashboard/DashboardContext'

const CASE_STATUS_AR: Record<string, string> = { ACTIVE: 'نشطة', CLOSED: 'مغلقة', SUSPENDED: 'معلقة', PENDING: 'قيد الانتظار' }
const CASE_STATUS_BADGE: Record<string, 'ac' | 'cl' | 'pe' | 'ur'> = { ACTIVE: 'ac', CLOSED: 'cl', SUSPENDED: 'pe', PENDING: 'ur' }

export default function CasesPage() {
  const { openModal, refreshKey } = useDashboard()
  const [cases, setCases] = useState<any[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('ALL')

  useEffect(() => {
    setLoading(true)
    fetch('/api/cases')
      .then(r => { setTotal(Number(r.headers.get('X-Total-Count') ?? '0')); return r.json() })
      .then(d => { if (Array.isArray(d)) setCases(d) })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [refreshKey])

  const filtered = filter === 'ALL' ? cases : cases.filter(c => c.status === filter)

  return (
    <div className="pg">
      <SectionHeader title="إدارة القضايا" subtitle={`${cases.filter(c => c.status === 'ACTIVE').length} قضية نشطة`}>
        <button className="dbtn dbtn-p" onClick={() => openModal('m-add-case')}>+ قضية جديدة</button>
      </SectionHeader>
      <div style={{ display: 'flex', gap: 9, marginBottom: 16, flexWrap: 'wrap' }}>
        {['ALL', 'ACTIVE', 'SUSPENDED', 'CLOSED', 'PENDING'].map(s => (
          <button key={s} onClick={() => setFilter(s)} className="dbtn" style={{ background: filter === s ? 'var(--gold)' : 'rgba(255,255,255,.06)', color: filter === s ? '#0F172A' : '#94A3B8', border: 'none', padding: '5px 14px', borderRadius: 20, fontSize: '.78rem', fontWeight: 700, cursor: 'pointer' }}>
            {s === 'ALL' ? `الكل (${cases.length})` : `${CASE_STATUS_AR[s]} (${cases.filter(c => c.status === s).length})`}
          </button>
        ))}
      </div>
      {total > cases.length && (
        <div style={{ color: '#F59E0B', fontSize: '.78rem', marginBottom: 10 }}>⚠️ تُعرض أحدث {cases.length} من أصل {total} قضية</div>
      )}
      <div className="card">
        {loading ? <div style={{ padding: 32, textAlign: 'center', color: '#94A3B8' }}>جارٍ التحميل...</div> : (
          <table className="dt">
            <tbody>
              <tr><th>رقم القضية</th><th>العنوان</th><th>النوع</th><th>الموكل</th><th>المحكمة</th><th>المحامي</th><th>الجلسات</th><th>الحالة</th><th /></tr>
              {filtered.map((c) => (
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
              {filtered.length === 0 && <tr><td colSpan={9} style={{ textAlign: 'center', color: '#94A3B8', padding: 24 }}>لا توجد قضايا</td></tr>}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
