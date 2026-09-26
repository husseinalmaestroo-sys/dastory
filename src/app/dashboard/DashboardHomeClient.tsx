'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { fmtDate, fmtMoney, statusAr } from '@/lib/api'
import { Badge, Notification, QuickAction, SectionHeader, StatCard, ErrorState } from '@/components/dashboard/ui'
import { apiFetch, errorMessage } from '@/lib/dashboard/api-client'
import { useDashboard } from '@/components/dashboard/DashboardContext'

type DashStats = {
  totalClients: number
  totalCases: number
  activeCases: number
  upcomingSessions: number
  revenue: number
  unpaid: number
  totalRevenue: number
}
type RecentCase = { id: string; number: string; title: string; court: string; status: string; client: { name: string } }
type UpcomingSession = { id: string; date: string; time: string; court: string; case: { number: string; title: string } }

function statusBadgeType(s: string): 'ac' | 'pe' | 'cl' | 'ur' {
  if (s === 'ACTIVE') return 'ac'
  if (s === 'CLOSED') return 'cl'
  if (s === 'SUSPENDED') return 'pe'
  return 'ur'
}

export default function DashboardHomeClient({ authUserName }: { authUserName: string }) {
  const router = useRouter()
  const { openModal, refreshKey } = useDashboard()
  const [stats, setStats] = useState<DashStats | null>(null)
  const [recentCases, setRecentCases] = useState<RecentCase[]>([])
  const [todaySessions, setTodaySessions] = useState<UpcomingSession[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [retryKey, setRetryKey] = useState(0)

  useEffect(() => {
    let cancelled = false
    apiFetch<any>('/api/dashboard')
      .then(({ data: d }) => {
        if (cancelled) return
        setStats(d.stats)
        setRecentCases(d.recentCases ?? [])
        setTodaySessions(d.todaySessions ?? [])
        setError('')
      })
      .catch((err) => { if (!cancelled) setError(errorMessage(err)) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [refreshKey, retryKey])

  return (
    <div className="pg">
      <SectionHeader title="لوحة التحكم" subtitle={`مرحباً ${authUserName.split(' ')[0] ?? ''}، إليك ملخص اليوم`}>
      </SectionHeader>
      {error && <ErrorState message={`تعذّر تحميل ملخص اللوحة: ${error}`} onRetry={() => setRetryKey((k) => k + 1)} />}

      <div className="sg">
        <StatCard icon="⚖️" value={loading ? '...' : String(stats?.activeCases ?? 0)} label="القضايا المفتوحة" change={stats ? `${stats.totalCases} إجمالي` : undefined} />
        <StatCard icon="📅" value={loading ? '...' : String(stats?.upcomingSessions ?? 0)} label="جلسات قادمة" change={stats ? `${stats.totalClients} عميل` : undefined} />
        <StatCard icon="💳" value={loading ? '...' : fmtMoney(stats?.revenue ?? 0)} label="الإيرادات المحصلة" change={stats ? `${fmtMoney(stats.unpaid)} غير محصل` : undefined} down={!!stats && stats.unpaid > 0} />
        <StatCard icon="💰" value={loading ? '...' : fmtMoney(stats?.totalRevenue ?? 0)} label="إجمالي الفواتير" />
      </div>

      <div className="g2" style={{ marginBottom: 14 }}>
        <div className="card">
          <div className="ct">⚖️ القضايا الأخيرة</div>
          <table className="dt">
            <tbody>
              <tr>
                <th>القضية</th>
                <th>الموكل</th>
                <th>المحكمة</th>
                <th>الحالة</th>
              </tr>
              {loading ? (
                <tr><td colSpan={4} style={{ textAlign: 'center', color: '#64748B', padding: 20 }}>جاري التحميل...</td></tr>
              ) : recentCases.length === 0 ? (
                <tr><td colSpan={4} style={{ textAlign: 'center', color: '#64748B', padding: 20 }}>لا توجد قضايا</td></tr>
              ) : recentCases.map(c => (
                <tr key={c.id}>
                  <td>{c.number} — {c.title}</td>
                  <td>{c.client.name}</td>
                  <td>{c.court || '—'}</td>
                  <td><Badge type={statusBadgeType(c.status)}>● {statusAr[c.status] ?? c.status}</Badge></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div className="card">
            <div className="ct">📅 الجلسات القادمة</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {loading ? (
                <div style={{ color: '#64748B', fontSize: '.82rem', textAlign: 'center', padding: 16 }}>جاري التحميل...</div>
              ) : todaySessions.length === 0 ? (
                <div style={{ color: '#64748B', fontSize: '.82rem', textAlign: 'center', padding: 16 }}>لا توجد جلسات قادمة</div>
              ) : todaySessions.map((s, i) => (
                <div key={s.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: 9, background: i === 0 ? 'rgba(212,175,55,.07)' : 'rgba(255,255,255,.03)', borderRadius: 9, border: `1px solid ${i === 0 ? 'rgba(212,175,55,.15)' : 'transparent'}` }}>
                  <div>
                    <div style={{ fontSize: '.82rem', fontWeight: 700, color: '#E2E8F0' }}>{s.case.number} — {s.case.title}</div>
                    <div style={{ fontSize: '.72rem', color: '#94A3B8', marginTop: 2 }}>{s.court}</div>
                  </div>
                  <div style={{ textAlign: 'left' }}>
                    <div style={{ fontSize: '.78rem', color: i === 0 ? 'var(--gold, #D4AF37)' : '#60A5FA', fontWeight: 700 }}>{fmtDate(s.date)}</div>
                    <div style={{ fontSize: '.7rem', color: '#64748B' }}>{s.time}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="card">
            <div className="ct">🔔 إشعارات ذكية</div>
            <Notification icon="⚠️" color="#EF4444" title="عقد شركة الأمانة ينتهي بعد 7 أيام" subtitle="مراجعة وتجديد فوري" time="الآن" />
            <Notification icon="📅" color="#F59E0B" title="جلسة غداً — قضية 2024/1701" subtitle="تأكد من الأوراق والتحضير" time="منذ ساعة" />
            <Notification icon="💳" color="#10B981" title="دفعة مستحقة — أحمد المصري" subtitle="850 د.أ · تاريخ الاستحقاق: الأحد" time="3 ساعات" />
          </div>
        </div>
      </div>

      <div className="card">
        <div className="ct">⚡ إجراءات سريعة</div>
        <div className="qg">
          <QuickAction icon="⚖️" label="قضية جديدة" onClick={() => openModal('m-add-case')} />
          <QuickAction icon="👤" label="عميل جديد" onClick={() => openModal('m-add-client')} />
          <QuickAction icon="📄" label="راجع عقداً" onClick={() => router.push('/dashboard/ai/contract')} />
          <QuickAction icon="🤖" label="اسأل المساعد" onClick={() => router.push('/dashboard/ai/assistant')} />
          <QuickAction icon="📅" label="موعد جلسة" onClick={() => openModal('m-add-session')} />
          <QuickAction icon="📚" label="بحث قانوني" onClick={() => router.push('/dashboard/search/legal')} />
          <QuickAction icon="🧾" label="فاتورة جديدة" onClick={() => openModal('m-add-invoice')} />
          <QuickAction icon="📝" label="أنشئ مستنداً" onClick={() => router.push('/dashboard/documents/generate')} />
        </div>
      </div>
    </div>
  )
}
