'use client'

import { useEffect, useState } from 'react'
import { Badge, ErrorState, LoadMore, SectionHeader, StatCard } from '@/components/dashboard/ui'
import { useDashboard } from '@/components/dashboard/DashboardContext'
import { usePaginatedList } from '@/components/dashboard/usePaginatedList'
import { apiFetch, errorMessage } from '@/lib/dashboard/api-client'

const INV_STATUS_AR: Record<string, string> = { PAID: 'مدفوعة', UNPAID: 'غير مدفوعة', PARTIAL: 'جزئي', OVERDUE: 'متأخرة' }
const INV_STATUS_BADGE: Record<string, 'ac' | 'cl' | 'pe' | 'ur'> = { PAID: 'ac', UNPAID: 'cl', PARTIAL: 'pe', OVERDUE: 'ur' }

type Summary = { count: number; paidCount: number; totalAmount: number; totalPaid: number; totalOutstanding: number }

// Amounts are exact 3-decimal values from the API (DECIMAL(12,3)); display only.
const fmt = (n: number) => n.toLocaleString('ar-JO', { maximumFractionDigits: 3 })

export default function InvoicesPage() {
  const { openModal, refreshKey } = useDashboard()
  const list = usePaginatedList<any>('/api/invoices', refreshKey)
  const [summary, setSummary] = useState<Summary | null>(null)
  const [summaryError, setSummaryError] = useState<string | null>(null)

  // Totals come from the server (exact DECIMAL sums over every invoice the
  // user may see), not from adding up the rows loaded on this page.
  useEffect(() => {
    let cancelled = false
    apiFetch<Summary>('/api/invoices/summary')
      .then(({ data }) => { if (!cancelled) { setSummary(data); setSummaryError(null) } })
      .catch((err) => { if (!cancelled) setSummaryError(errorMessage(err)) })
    return () => { cancelled = true }
  }, [refreshKey])

  return (
    <div className="pg">
      <SectionHeader title="الفواتير" subtitle={summary ? `إجمالي مستحق: ${fmt(summary.totalOutstanding)} د.أ` : ''}>
        <button className="dbtn dbtn-p" onClick={() => openModal('m-add-invoice')}>+ فاتورة جديدة</button>
      </SectionHeader>
      {summaryError ? <ErrorState message={summaryError} /> : (
        <div className="sg">
          <StatCard icon="💰" value={summary ? fmt(summary.totalPaid) : '…'} label="إجمالي المحصّل (د.أ)" />
          <StatCard icon="⏳" value={summary ? fmt(summary.totalOutstanding) : '…'} label="مستحقات غير مدفوعة" />
          <StatCard icon="✅" value={summary ? String(summary.paidCount) : '…'} label="فواتير مدفوعة" />
          <StatCard icon="📋" value={summary ? String(summary.count) : '…'} label="إجمالي الفواتير" />
        </div>
      )}
      <div className="card">
        <div className="ct">🧾 الفواتير</div>
        {list.loading ? <div style={{ padding: 24, textAlign: 'center', color: '#94A3B8' }}>جارٍ التحميل...</div> : list.error && list.items.length === 0 ? (
          <ErrorState message={list.error} onRetry={list.retry} />
        ) : (
          <>
            <table className="dt">
              <tbody>
                <tr><th>رقم الفاتورة</th><th>العميل</th><th>القضية</th><th>المبلغ</th><th>المدفوع</th><th>الاستحقاق</th><th>الحالة</th><th /></tr>
                {list.items.map((inv) => (
                  <tr key={inv.id}>
                    <td><b>{inv.number}</b></td>
                    <td>{inv.client.name}</td>
                    <td>{inv.case?.number ?? '—'}</td>
                    <td>{fmt(inv.amount)} د.أ</td>
                    <td>{fmt(inv.paid)} د.أ</td>
                    <td>{inv.dueDate ? new Date(inv.dueDate).toLocaleDateString('ar-JO') : '—'}</td>
                    <td><Badge type={INV_STATUS_BADGE[inv.status]}>{INV_STATUS_AR[inv.status]}</Badge></td>
                    <td><button className="dbtn dbtn-s" style={{ padding: '4px 10px', fontSize: '.72rem' }} onClick={() => openModal('m-edit-invoice', { invoiceId: inv.id })}>✏️ تعديل</button></td>
                  </tr>
                ))}
                {list.items.length === 0 && <tr><td colSpan={8} style={{ textAlign: 'center', color: '#94A3B8', padding: 24 }}>لا توجد فواتير</td></tr>}
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
