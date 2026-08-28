import { getFullAuthUser } from '@/lib/session'
import DashboardHomeClient from './DashboardHomeClient'

export default async function DashboardHomePage() {
  const authUser = await getFullAuthUser()
  return <DashboardHomeClient authUserName={authUser?.name ?? ''} />
}
