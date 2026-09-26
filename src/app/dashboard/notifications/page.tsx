'use client'

import { useEffect, useState } from 'react'
import { ErrorState, LoadMore, Notification, SectionHeader } from '@/components/dashboard/ui'
import { usePaginatedList } from '@/components/dashboard/usePaginatedList'
import { apiFetch, errorMessage } from '@/lib/dashboard/api-client'

export default function NotificationsPage() {
  const [reloadKey, setReloadKey] = useState(0)
  const list = usePaginatedList<any>('/api/notifications', reloadKey, 20)
  const [unread, setUnread] = useState<number | null>(null)
  const [markError, setMarkError] = useState('')
  // Captured once via the lazy initializer — calling Date.now() straight in
  // the render body (inside timeAgo) trips react-hooks/purity.
  const [now] = useState(() => Date.now())

  useEffect(() => {
    let cancelled = false
    apiFetch('/api/notifications?limit=1')
      .then(({ res }) => { if (!cancelled) setUnread(Number(res.headers.get('X-Unread-Count') ?? '0')) })
      .catch(() => { if (!cancelled) setUnread(null) })
    return () => { cancelled = true }
  }, [reloadKey])

  const markAll = async () => {
    setMarkError('')
    try {
      await apiFetch('/api/notifications', { method: 'PATCH' })
      list.setItems((items) => items.map(n => ({ ...n, read: true })))
      setUnread(0)
    } catch (err) {
      setMarkError(errorMessage(err))
    }
  }

  const timeAgo = (d: string) => {
    const diff = now - new Date(d).getTime()
    const m = Math.floor(diff / 60000)
    if (m < 1) return 'الآن'
    if (m < 60) return `منذ ${m} دقيقة`
    const h = Math.floor(m / 60)
    if (h < 24) return `منذ ${h} ساعة`
    return `منذ ${Math.floor(h / 24)} يوم`
  }

  return (
    <div className="pg">
      <SectionHeader title="الإشعارات" subtitle={unread !== null ? `${unread} إشعار جديد` : ''}>
        <button className="dbtn dbtn-s" onClick={markAll}>تحديد الكل كمقروء</button>
      </SectionHeader>
      {markError && <ErrorState message={markError} />}
      <div className="card">
        {list.loading ? <div style={{ padding: 24, textAlign: 'center', color: '#94A3B8' }}>جارٍ التحميل...</div> : list.error && list.items.length === 0 ? (
          <ErrorState message={list.error} onRetry={() => setReloadKey((k) => k + 1)} />
        ) : (
          <>
            {list.items.length === 0
              ? <div style={{ padding: 24, textAlign: 'center', color: '#94A3B8' }}>لا توجد إشعارات</div>
              : list.items.map((n) => (
                <div key={n.id} style={{ opacity: n.read ? 0.6 : 1 }}>
                  <Notification icon={n.read ? '📩' : '🔔'} color={n.read ? '#64748B' : '#F59E0B'} title={n.title} subtitle={n.body} time={timeAgo(n.createdAt)} />
                </div>
              ))}
            {list.error && <ErrorState message={list.error} onRetry={list.loadMore} />}
            <LoadMore shown={list.items.length} total={list.total} hasMore={list.hasMore} loading={list.loadingMore} onClick={list.loadMore} />
          </>
        )}
      </div>
    </div>
  )
}
