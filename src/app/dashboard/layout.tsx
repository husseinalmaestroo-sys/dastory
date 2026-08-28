import { redirect } from 'next/navigation'
import { getFullAuthUser, getSessionUser } from '@/lib/session'
import { DashboardShellProvider } from '@/components/dashboard/DashboardContext'
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

  return (
    <div id="dboard-body">
      <DashboardShellProvider isAdmin={isAdmin}>
        <div id="app">
          <Sidebar authUser={authUser} isAdmin={isAdmin} />
          <main id="main">
            <TopBar />
            {children}
          </main>
        </div>
      </DashboardShellProvider>
    </div>
  )
}
