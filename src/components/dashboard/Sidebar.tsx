'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { ADMIN_NAV, BASE_NAV } from '@/lib/dashboard/nav'
import { useDashboard } from './DashboardContext'
import type { AuthUser } from '@/lib/dashboard/types'

export default function Sidebar({ authUser, isAdmin }: { authUser: AuthUser; isAdmin: boolean }) {
  const pathname = usePathname()
  const router = useRouter()
  const { refreshKey } = useDashboard()
  const [counts, setCounts] = useState({ cases: 0, sessions: 0, notifs: 0 })

  useEffect(() => {
    // Badges are decoration: on failure they are simply omitted (the pages
    // themselves show the error), but the failure is logged, not swallowed.
    Promise.all([
      fetch('/api/dashboard').then(r => (r.ok ? r.json() : null)),
      // limit=1: only the X-Unread-Count header is needed — it counts ALL
      // unread notifications, not just those on the first page.
      fetch('/api/notifications?limit=1').then(r => (r.ok ? Number(r.headers.get('X-Unread-Count') ?? '0') : 0)),
    ]).then(([dash, unread]) => {
      setCounts({
        cases: dash?.stats?.activeCases ?? 0,
        sessions: dash?.stats?.upcomingSessions ?? 0,
        notifs: unread,
      })
    }).catch((err) => console.warn('[sidebar] badge counts unavailable', err))
  }, [refreshKey])

  const sections = isAdmin ? [...BASE_NAV, ADMIN_NAV] : BASE_NAV

  const badgeFor = (href: string) => {
    if (href === '/dashboard/cases' && counts.cases > 0) return String(counts.cases)
    if (href === '/dashboard/sessions' && counts.sessions > 0) return String(counts.sessions)
    if (href === '/dashboard/notifications' && counts.notifs > 0) return String(counts.notifs)
    return null
  }

  const logout = async () => {
    await fetch('/api/auth/logout', { method: 'POST' })
    router.push('/login')
  }

  return (
    <aside id="sb">
      <div className="sb-logo">
        <div className="brand">دُسْتُورِي</div>
        <div className="sub">{isAdmin ? 'لوحة تحكم مدير المكتب' : 'لوحة تحكم المحامي'}</div>
      </div>
      <div className="lcard2">
        <div className="av">{authUser.name?.[0] ?? 'م'}</div>
        <div>
          <div className="li-name">{authUser.name ?? ''}</div>
          <div className="li-role">{authUser.officeName ?? 'مكتب مستقل'}</div>
          <div className="li-role">{isAdmin ? 'مدير المكتب — صلاحيات كاملة' : 'محامٍ'}</div>
          <span className="li-badge">{isAdmin ? 'صلاحيات كاملة' : authUser.barNumber ? `نقابة # ${authUser.barNumber}` : 'محامٍ'}</span>
        </div>
      </div>

      <nav aria-label="التنقل الرئيسي">
        {sections.map((section) => (
          <div key={section.label}>
            <div className="nl">{section.label}</div>
            {section.items.map((item) => {
              const active = item.href === '/dashboard' ? pathname === '/dashboard' : pathname.startsWith(item.href)
              const badge = badgeFor(item.href)
              return (
                <Link key={item.href} href={item.href} className={`ni${active ? ' active' : ''}`} aria-current={active ? 'page' : undefined}>
                  <span className="ic">{item.icon}</span>
                  {item.label}
                  {badge && <span className="bc">{badge}</span>}
                </Link>
              )
            })}
          </div>
        ))}
      </nav>

      <div className="sb-foot">
        <button className="btn-out" onClick={logout}>
          ⬅ تسجيل الخروج
        </button>
      </div>
    </aside>
  )
}
