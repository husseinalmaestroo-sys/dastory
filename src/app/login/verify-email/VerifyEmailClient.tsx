'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'

type Status = 'checking' | 'success' | 'error'

export default function VerifyEmailClient({ token }: { token: string }) {
  const [status, setStatus] = useState<Status>(token ? 'checking' : 'error')
  // Seeded here rather than via a synchronous setMessage in the effect
  // (react-hooks/set-state-in-effect); with no token the effect does nothing.
  const [message, setMessage] = useState(token ? '' : 'رابط التأكيد غير مكتمل')

  useEffect(() => {
    if (!token) return
    let alive = true
    fetch('/api/auth/verify-email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
    })
      .then(async (res) => {
        if (!alive) return
        const data = await res.json().catch(() => ({}))
        if (res.ok) { setStatus('success'); return }
        setStatus('error')
        setMessage(data.error || 'تعذر تأكيد البريد الإلكتروني')
      })
      .catch(() => { if (alive) { setStatus('error'); setMessage('تعذّر الاتصال بالخادم') } })
    return () => { alive = false }
  }, [token])

  return (
    <div id="dboard-body">
      <div id="login-screen">
        <div className="lcard">
          <div className="llogo">
            <div className="brand">دُسْتُورِي</div>
            <div className="sub">تأكيد البريد الإلكتروني</div>
          </div>
          {status === 'checking' && (
            <div style={{ color: '#94A3B8', fontSize: '.85rem', textAlign: 'center', padding: '10px 0' }}>جارٍ التأكيد...</div>
          )}
          {status === 'success' && (
            <>
              <div style={{ color: '#10B981', fontSize: '.85rem', textAlign: 'center', lineHeight: 1.8, padding: '10px 0' }}>
                ✅ تم تأكيد بريدك الإلكتروني بنجاح.
              </div>
              <Link href="/dashboard" className="btn-login" style={{ display: 'block', textAlign: 'center', textDecoration: 'none' }}>
                الذهاب إلى لوحة التحكم
              </Link>
            </>
          )}
          {status === 'error' && (
            <>
              <div style={{ color: '#EF4444', fontSize: '.85rem', textAlign: 'center', lineHeight: 1.8, padding: '10px 0' }}>
                ⚠ {message}
              </div>
              <Link href="/dashboard/settings" className="btn-login" style={{ display: 'block', textAlign: 'center', textDecoration: 'none' }}>
                طلب رابط تأكيد جديد
              </Link>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
