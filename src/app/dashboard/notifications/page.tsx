'use client'

import { useEffect, useState } from 'react'
import { Notification, SectionHeader } from '@/components/dashboard/ui'

export default function NotificationsPage() {
  const [notifs, setNotifs] = useState<any[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/notifications').then(r => r.json()).then(setNotifs).finally(() => setLoading(false))
  }, [])

  const unread = notifs.filter(n => !n.read).length

  const markAll = async () => {
    await fetch('/api/notifications', { method: 'PATCH' })
    setNotifs(notifs.map(n => ({ ...n, read: true })))
  }

  const timeAgo = (d: string) => {
    const diff = Date.now() - new Date(d).getTime()
    const m = Math.floor(diff / 60000)
    if (m < 1) return 'الآن'
    if (m < 60) return `منذ ${m} دقيقة`
    const h = Math.floor(m / 60)
    if (h < 24) return `منذ ${h} ساعة`
    return `منذ ${Math.floor(h / 24)} يوم`
  }

  return (
    <div className="pg">
      <SectionHeader title="الإشعارات" subtitle={`${unread} إشعار جديد`}>
        <button className="dbtn dbtn-s" onClick={markAll}>تحديد الكل كمقروء</button>
      </SectionHeader>
      <div className="card">
        {loading ? <div style={{ padding: 24, textAlign: 'center', color: '#94A3B8' }}>جارٍ التحميل...</div> : (
          notifs.length === 0
            ? <div style={{ padding: 24, textAlign: 'center', color: '#94A3B8' }}>لا توجد إشعارات</div>
            : notifs.map((n) => (
              <div key={n.id} style={{ opacity: n.read ? 0.6 : 1 }}>
                <Notification icon={n.read ? '📩' : '🔔'} color={n.read ? '#64748B' : '#F59E0B'} title={n.title} subtitle={n.body} time={timeAgo(n.createdAt)} />
              </div>
            ))
        )}
      </div>
    </div>
  )
}
