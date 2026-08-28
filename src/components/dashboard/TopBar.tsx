'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { PAGE_TITLES } from '@/lib/dashboard/nav'
import { useDashboard } from './DashboardContext'

export default function TopBar() {
  const pathname = usePathname()
  const { openModal } = useDashboard()
  const title = PAGE_TITLES[pathname] ?? 'دُسْتُورِي'

  return (
    <div className="tph">
      <div className="tph-title">{title}</div>
      <div className="tph-ax">
        <Link className="ic-btn" href="/dashboard/notifications" aria-label="الإشعارات">
          🔔<span className="dot" />
        </Link>
        <Link className="ic-btn" href="/dashboard/ai/assistant" aria-label="المساعد القانوني">
          🤖
        </Link>
        <button className="dbtn dbtn-p" onClick={() => openModal('m-add-case')} style={{ height: 32, fontSize: '.76rem' }}>
          + قضية جديدة
        </button>
      </div>
    </div>
  )
}
