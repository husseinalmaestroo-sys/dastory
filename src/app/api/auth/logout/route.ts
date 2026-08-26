import { NextRequest, NextResponse } from 'next/server'
import { getUser } from '@/lib/auth-server'
import { auditLog } from '@/lib/audit'
import { rejectCrossSite } from '@/lib/api-security'

export async function POST(req: NextRequest) {
  const blocked = rejectCrossSite(req)
  if (blocked) return blocked

  const user = getUser(req)
  await auditLog(req, user, 'auth.logout')

  const res = NextResponse.json({ ok: true })
  res.cookies.set('ds_token', '', { maxAge: 0, path: '/' })
  return res
}
