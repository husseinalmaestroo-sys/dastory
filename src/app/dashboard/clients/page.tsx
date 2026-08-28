'use client'

import { useEffect, useState } from 'react'
import { Badge, SectionHeader } from '@/components/dashboard/ui'
import { useDashboard } from '@/components/dashboard/DashboardContext'

export default function ClientsPage() {
  const { openModal, refreshKey } = useDashboard()
  const [clients, setClients] = useState<any[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')

  useEffect(() => {
    setLoading(true)
    const q = search.trim()
    const timer = window.setTimeout(() => {
      fetch(`/api/clients${q ? `?q=${encodeURIComponent(q)}` : ''}`)
        .then(r => { setTotal(Number(r.headers.get('X-Total-Count') ?? '0')); return r.json() })
        .then(d => { if (Array.isArray(d)) setClients(d) })
        .catch(() => {})
        .finally(() => setLoading(false))
    }, q ? 300 : 0)
    return () => window.clearTimeout(timer)
  }, [refreshKey, search])

  return (
    <div className="pg">
      <SectionHeader title="إدارة العملاء" subtitle={`${total} عميل`}>
        <button className="dbtn dbtn-p" onClick={() => openModal('m-add-client')}>+ عميل جديد</button>
      </SectionHeader>
      <div className="sb2"><div className="si">🔍</div><input placeholder="ابحث باسم العميل أو رقم الهاتف..." value={search} onChange={e => setSearch(e.target.value)} /></div>
      {!search && total > clients.length && (
        <div style={{ color: '#F59E0B', fontSize: '.78rem', marginBottom: 10 }}>⚠️ تُعرض أحدث {clients.length} من أصل {total} — استخدم البحث لتضييق النتائج</div>
      )}
      <div className="card" style={{ marginBottom: 14 }}>
        {loading ? <div style={{ padding: 32, textAlign: 'center', color: '#94A3B8' }}>جارٍ التحميل...</div> : (
          <table className="dt">
            <tbody>
              <tr><th>اسم العميل</th><th>الهاتف</th><th>البريد</th><th>القضايا</th><th>الفواتير</th><th /></tr>
              {clients.map((c) => (
                <tr key={c.id}>
                  <td><b>{c.name}</b></td>
                  <td>{c.phone ?? '—'}</td>
                  <td>{c.email ?? '—'}</td>
                  <td><Badge type="bl">{c._count.cases} قضية</Badge></td>
                  <td><Badge type="go">{c._count.invoices} فاتورة</Badge></td>
                  <td><button className="dbtn dbtn-s" style={{ padding: '4px 10px', fontSize: '.72rem' }} onClick={() => openModal('m-client-detail', { clientId: c.id })}>عرض</button></td>
                </tr>
              ))}
              {!loading && clients.length === 0 && <tr><td colSpan={6} style={{ textAlign: 'center', color: '#94A3B8', padding: 24 }}>لا توجد نتائج</td></tr>}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
