'use client'

import { useEffect, useState } from 'react'
import { Badge, SectionHeader, StatCard } from '@/components/dashboard/ui'
import { useDashboard } from '@/components/dashboard/DashboardContext'

const INV_STATUS_AR: Record<string, string> = { PAID: 'مدفوعة', UNPAID: 'غير مدفوعة', PARTIAL: 'جزئي', OVERDUE: 'متأخرة' }
const INV_STATUS_BADGE: Record<string, 'ac' | 'cl' | 'pe' | 'ur'> = { PAID: 'ac', UNPAID: 'cl', PARTIAL: 'pe', OVERDUE: 'ur' }

export default function InvoicesPage() {
  const { openModal, refreshKey } = useDashboard()
  const [invoices, setInvoices] = useState<any[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    fetch('/api/invoices').then(r => r.json()).then(d => { if (Array.isArray(d)) setInvoices(d) }).catch(() => {}).finally(() => setLoading(false))
  }, [refreshKey])

  const totalAmount = invoices.reduce((s, i) => s + i.amount, 0)
  const totalPaid = invoices.reduce((s, i) => s + i.paid, 0)
  const totalUnpaid = totalAmount - totalPaid
  const countPaid = invoices.filter(i => i.status === 'PAID').length

  return (
    <div className="pg">
      <SectionHeader title="الفواتير" subtitle={`إجمالي مستحق: ${totalUnpaid.toLocaleString('ar-JO')} د.أ`}>
        <button className="dbtn dbtn-p" onClick={() => openModal('m-add-invoice')}>+ فاتورة جديدة</button>
      </SectionHeader>
      <div className="sg">
        <StatCard icon="💰" value={totalPaid.toLocaleString('ar-JO')} label="إجمالي المحصّل (د.أ)" />
        <StatCard icon="⏳" value={totalUnpaid.toLocaleString('ar-JO')} label="مستحقات غير مدفوعة" />
        <StatCard icon="✅" value={String(countPaid)} label="فواتير مدفوعة" />
        <StatCard icon="📋" value={String(invoices.length)} label="إجمالي الفواتير" />
      </div>
      <div className="card">
        <div className="ct">🧾 الفواتير</div>
        {loading ? <div style={{ padding: 24, textAlign: 'center', color: '#94A3B8' }}>جارٍ التحميل...</div> : (
          <table className="dt">
            <tbody>
              <tr><th>رقم الفاتورة</th><th>العميل</th><th>القضية</th><th>المبلغ</th><th>المدفوع</th><th>الاستحقاق</th><th>الحالة</th><th /></tr>
              {invoices.map((inv) => (
                <tr key={inv.id}>
                  <td><b>{inv.number}</b></td>
                  <td>{inv.client.name}</td>
                  <td>{inv.case?.number ?? '—'}</td>
                  <td>{inv.amount.toLocaleString('ar-JO')} د.أ</td>
                  <td>{inv.paid.toLocaleString('ar-JO')} د.أ</td>
                  <td>{inv.dueDate ? new Date(inv.dueDate).toLocaleDateString('ar-JO') : '—'}</td>
                  <td><Badge type={INV_STATUS_BADGE[inv.status]}>{INV_STATUS_AR[inv.status]}</Badge></td>
                  <td><button className="dbtn dbtn-s" style={{ padding: '4px 10px', fontSize: '.72rem' }} onClick={() => openModal('m-edit-invoice', { invoiceId: inv.id })}>✏️ تعديل</button></td>
                </tr>
              ))}
              {invoices.length === 0 && <tr><td colSpan={8} style={{ textAlign: 'center', color: '#94A3B8', padding: 24 }}>لا توجد فواتير</td></tr>}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
