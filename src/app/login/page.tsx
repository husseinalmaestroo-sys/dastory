import { redirect } from 'next/navigation'
import { getSessionUser } from '@/lib/session'
import LoginClient from './LoginClient'
import '@/styles/dashboard-app.css'

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ resetToken?: string }>
}) {
  const { resetToken } = await searchParams

  // A reset link should work regardless of whether the browser already has
  // an (unrelated) session — skip the redirect-if-authenticated check in
  // that case, same as the pre-refactor behavior.
  if (!resetToken) {
    const user = await getSessionUser()
    if (user) redirect(user.role === 'CITIZEN' ? '/citizen' : '/dashboard')
  }

  return <LoginClient initialResetToken={resetToken ?? ''} />
}
