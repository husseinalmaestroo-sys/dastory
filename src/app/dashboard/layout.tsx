import { redirect } from 'next/navigation'
import { getFullAuthUser, getSessionUser } from '@/lib/session'
import { getSubscriptionEnforcement } from '@/lib/billing'
import { DashboardShellProvider } from '@/components/dashboard/DashboardContext'
import { SubscriptionGate } from '@/components/dashboard/SubscriptionGate'
import Sidebar from '@/components/dashboard/Sidebar'
import TopBar from '@/components/dashboard/TopBar'
import '@/styles/dashboard-app.css'

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const sessionUser = await getSessionUser()
  if (!sessionUser) redirect('/login')
  if (sessionUser.role === 'CITIZEN') redirect('/citizen')

  const authUser = await getFullAuthUser()
  if (!authUser) redirect('/login')

  const isAdmin = authUser.role === 'OFFICE_MANAGER'
  // Platform admins are exempt — see the matching bypass in requireOfficeUser.
  const { tier } = authUser.isPlatformAdmin
    ? { tier: 'active' as const }
    : await getSubscriptionEnforcement(authUser.officeId)

  return (
    <div id="dboard-body">
      <DashboardShellProvider isAdmin={isAdmin}>
        <div id="app">
          <Sidebar authUser={authUser} isAdmin={isAdmin} />
          <main id="main">
            <TopBar />
            <SubscriptionGate tier={tier} isAdmin={isAdmin}>
              {children}
            </SubscriptionGate>
          </main>
        </div>
      </DashboardShellProvider>
    </div>
  )
}
