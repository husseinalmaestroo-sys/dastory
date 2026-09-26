'use client'

import { useEffect, useState } from 'react'
import { Badge, ErrorState, LoadMore, SectionHeader } from '@/components/dashboard/ui'
import { useDashboard } from '@/components/dashboard/DashboardContext'
import { usePaginatedList } from '@/components/dashboard/usePaginatedList'

export default function ClientsPage() {
  const { openModal, refreshKey } = useDashboard()
  const [search, setSearch] = useState('')
  const [query, setQuery] = useState('')

  // Debounce typing into the query the list actually fetches.
  useEffect(() => {
    const q = search.trim()
    const timer = window.setTimeout(() => setQuery(q), q ? 300 : 0)
    return () => window.clearTimeout(timer)
  }, [search])

  const list = usePaginatedList<any>(`/api/clients${query ? `?q=${encodeURIComponent(query)}` : ''}`, refreshKey)

  return (
    <div className="pg">
      <SectionHeader title="إدارة العملاء" subtitle={`${list.total ?? list.items.length} عميل`}>
        <button className="dbtn dbtn-p" onClick={() => openModal('m-add-client')}>+ عميل جديد</button>
      </SectionHeader>
      <div className="sb2"><div className="si">🔍</div><input placeholder="ابحث باسم العميل أو رقم الهاتف..." value={search} onChange={e => setSearch(e.target.value)} /></div>
      <div className="card" style={{ marginBottom: 14 }}>
        {list.loading ? <div style={{ padding: 32, textAlign: 'center', color: '#94A3B8' }}>جارٍ التحميل...</div> : list.error && list.items.length === 0 ? (
          <ErrorState message={list.error} onRetry={list.retry} />
        ) : (
          <>
            <table className="dt">
              <tbody>
                <tr><th>اسم العميل</th><th>الهاتف</th><th>البريد</th><th>القضايا</th><th>الفواتير</th><th /></tr>
                {list.items.map((c) => (
                  <tr key={c.id}>
                    <td><b>{c.name}</b></td>
                    <td>{c.phone ?? '—'}</td>
                    <td>{c.email ?? '—'}</td>
                    <td><Badge type="bl">{c._count.cases} قضية</Badge></td>
                    <td><Badge type="go">{c._count.invoices} فاتورة</Badge></td>
                    <td><button className="dbtn dbtn-s" style={{ padding: '4px 10px', fontSize: '.72rem' }} onClick={() => openModal('m-client-detail', { clientId: c.id })}>عرض</button></td>
                  </tr>
                ))}
                {list.items.length === 0 && <tr><td colSpan={6} style={{ textAlign: 'center', color: '#94A3B8', padding: 24 }}>{query ? 'لا توجد نتائج' : 'لا يوجد عملاء بعد'}</td></tr>}
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
