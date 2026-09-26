'use client'

import { useEffect, useState } from 'react'
import { fmtMoney } from '@/lib/api'
import { Bars, ErrorState, SectionHeader, StatCard } from '@/components/dashboard/ui'
import { apiFetch, errorMessage } from '@/lib/dashboard/api-client'
import { useDashboard } from '@/components/dashboard/DashboardContext'

function RestrictedNotice() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: 340, gap: 12, color: '#64748B', textAlign: 'center', padding: 40 }}>
      <div style={{ fontSize: '3rem' }}>🔒</div>
      <div style={{ fontSize: '1.1rem', fontWeight: 800, color: '#94A3B8' }}>صلاحية محدودة</div>
      <div style={{ fontSize: '.85rem', maxWidth: 320, lineHeight: 1.8 }}>التقارير متاحة لمدير المكتب فقط.</div>
    </div>
  )
}

export default function ReportsPage() {
  const { isAdmin } = useDashboard()
  if (!isAdmin) return <RestrictedNotice />
  return <ReportsPageContent />
}

function ReportsPageContent() {
  const [data, setData] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [retryKey, setRetryKey] = useState(0)

  useEffect(() => {
    let cancelled = false
    apiFetch<any>('/api/reports')
      .then(({ data }) => { if (!cancelled) { setData(data); setError('') } })
      .catch((err) => { if (!cancelled) setError(errorMessage(err)) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [retryKey])

  if (loading) return <div className="pg"><div style={{ padding: 48, textAlign: 'center', color: '#94A3B8' }}>جارٍ تحميل التقارير...</div></div>
  if (error) return <div className="pg"><ErrorState message={`تعذّر تحميل التقارير: ${error}`} onRetry={() => { setLoading(true); setRetryKey((k) => k + 1) }} /></div>

  const statusLabel: Record<string, string> = { ACTIVE: 'نشطة', CLOSED: 'مغلقة', SUSPENDED: 'موقوفة', PENDING: 'معلقة' }
  const totalCases = (data?.casesByStatus ?? []).reduce((s: number, c: any) => s + c._count._all, 0)
  const activeCases = (data?.casesByStatus ?? []).find((c: any) => c.status === 'ACTIVE')?._count._all ?? 0
  const unpaid = (data?.totalRevenue ?? 0) - (data?.totalPaid ?? 0)
  const maxType = Math.max(...((data?.casesByType ?? []).map((c: any) => c._count._all)), 1)

  return (
    <div className="pg">
      <SectionHeader title="التقارير والإحصائيات" subtitle={new Date().toLocaleDateString('ar-JO', { year: 'numeric', month: 'long' })}>
        <button className="dbtn dbtn-s" onClick={() => window.print()}>🖨️ طباعة</button>
      </SectionHeader>
      <div className="sg">
        <StatCard icon="⚖️" value={String(totalCases)} label="إجمالي القضايا" />
        <StatCard icon="📈" value={String(activeCases)} label="قضايا نشطة" />
        <StatCard icon="💰" value={fmtMoney(data?.totalPaid ?? 0)} label="إجمالي المحصّل" />
        <StatCard icon="⏳" value={fmtMoney(unpaid)} label="مستحقات غير محصّلة" />
      </div>
      <div className="g2" style={{ marginBottom: 14 }}>
        <div className="card">
          <div className="ct">⚖️ القضايا حسب الحالة</div>
          {totalCases === 0
            ? <div style={{ color: '#64748B', textAlign: 'center', padding: 16 }}>لا توجد قضايا</div>
            : <Bars items={(data?.casesByStatus ?? []).map((c: any) => [
                statusLabel[c.status] ?? c.status,
                String(c._count._all),
                `${Math.round((c._count._all / totalCases) * 100)}%`,
                c.status === 'ACTIVE' ? 'go' : c.status === 'CLOSED' ? '' : 'gn',
              ])} />
          }
        </div>
        <div className="card">
          <div className="ct">📋 القضايا حسب النوع</div>
          {(data?.casesByType ?? []).length === 0
            ? <div style={{ color: '#64748B', textAlign: 'center', padding: 16 }}>لا توجد بيانات</div>
            : <Bars items={(data?.casesByType ?? []).map((c: any) => [
                c.type,
                String(c._count._all),
                `${Math.round((c._count._all / maxType) * 100)}%`,
                'go',
              ])} />
          }
        </div>
      </div>
      <div className="card">
        <div className="ct">👨‍⚖️ الفريق القانوني — القضايا المسندة</div>
        {(data?.team ?? []).length === 0
          ? <div style={{ color: '#64748B', textAlign: 'center', padding: 16 }}>لا توجد بيانات</div>
          : <table className="dt"><tbody>
              <tr><th>الاسم</th><th>الدور</th><th>القضايا المسندة</th></tr>
              {(data?.team ?? []).map((m: any) => (
                <tr key={m.id}>
                  <td><b>{m.name}</b></td>
                  <td>{m.role === 'OFFICE_MANAGER' ? 'مدير المكتب' : 'محامي'}</td>
                  <td>{m._count.cases}</td>
                </tr>
              ))}
            </tbody></table>
        }
      </div>
      <div className="g2">
        <div className="card">
          <div className="ct">💳 الفواتير حسب الحالة</div>
          {(data?.invoicesByStatus ?? []).length === 0
            ? <div style={{ color: '#64748B', textAlign: 'center', padding: 16 }}>لا توجد فواتير</div>
            : <Bars items={(data?.invoicesByStatus ?? []).map((inv: any) => {
                const lblMap: Record<string, string> = { PAID: 'مدفوعة', UNPAID: 'غير مدفوعة', PARTIAL: 'جزئية', OVERDUE: 'متأخرة' }
                return [lblMap[inv.status] ?? inv.status, `${inv._count._all}`, `${Math.min(100, inv._count._all * 25)}%`, inv.status === 'PAID' ? 'go' : inv.status === 'OVERDUE' ? 'pink' : 'gn']
              })}
            />
          }
        </div>
        <div className="card">
          <div className="ct">📊 ملخص الإيرادات</div>
          <Bars items={[
            ['إجمالي الفواتير', fmtMoney(data?.totalRevenue ?? 0), '100%', 'go'],
            ['المحصّل', fmtMoney(data?.totalPaid ?? 0), data?.totalRevenue ? `${Math.round((data.totalPaid / data.totalRevenue) * 100)}%` : '0%', 'gn'],
            ['المتبقي', fmtMoney(unpaid), data?.totalRevenue ? `${Math.round((unpaid / data.totalRevenue) * 100)}%` : '0%', 'pink'],
          ]} />
        </div>
      </div>
    </div>
  )
}
