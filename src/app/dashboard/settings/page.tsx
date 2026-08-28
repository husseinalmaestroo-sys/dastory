import { getFullAuthUser } from '@/lib/session'
import SettingsClient from './SettingsClient'

export default async function SettingsPage() {
  const authUser = await getFullAuthUser()
  return (
    <SettingsClient
      initialTwoFactorEnabled={Boolean(authUser?.twoFactorEnabled)}
      initialEmailVerified={Boolean(authUser?.emailVerified)}
      email={authUser?.email ?? ''}
    />
  )
}
