'use client'

import { useState } from 'react'
import type { SubscriptionTier } from '@/lib/billing'

// Wraps the dashboard shell's page content. 'active' renders children as-is.
// 'grace' shows a dismissible warning above children — reads still work, the
// API only 402s writes (see subscriptionGate in auth-server.ts). 'blocked'
// replaces children entirely: every non-auth request already 402s server
// side, so a page here would just be a wall of failed fetches — show one
// message instead. Dismissal is plain component state, not localStorage: the
// layout stays mounted across dashboard navigation (so "dismissed" holds for
// the session) and resets on a full reload, which is the point — this is a
// payment nag, not a one-time tip.
export function SubscriptionGate({
  tier,
  isAdmin,
  children,
}: {
  tier: SubscriptionTier
  isAdmin: boolean
  children: React.ReactNode
}) {
  const [dismissed, setDismissed] = useState(false)

  if (tier === 'blocked') {
    return (
      <div className="card" style={{ margin: 20, border: '1px solid rgba(239,68,68,.3)', background: 'rgba(239,68,68,.06)', textAlign: 'center', padding: '48px 24px' }}>
        <div style={{ fontSize: '2rem', marginBottom: 12 }}>🔒</div>
        <div style={{ fontSize: '1.05rem', fontWeight: 800, color: '#F1F5F9', marginBottom: 8 }}>تم تعليق الوصول لهذا المكتب</div>
        <div style={{ fontSize: '.85rem', color: '#94A3B8', maxWidth: 440, margin: '0 auto', lineHeight: 1.9 }}>
          {isAdmin
            ? 'انتهت الفترة التجريبية أو تعذّر تجديد الاشتراك. تواصلوا مع فريق دُسْتُورِي لإعادة التفعيل.'
            : 'انتهى اشتراك المكتب. يرجى مراجعة مدير المكتب لإعادة التفعيل.'}
        </div>
      </div>
    )
  }

  return (
    <>
      {tier === 'grace' && !dismissed && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, margin: '18px 20px 0', padding: '10px 16px', background: 'rgba(245,158,11,.1)', border: '1px solid rgba(245,158,11,.3)', borderRadius: 10, fontSize: '.82rem', color: '#F59E0B' }}>
          <span>
            ⚠️{' '}
            {isAdmin
              ? 'انتهت صلاحية اشتراك المكتب — يمكنكم الاطلاع على البيانات الحالية، لكن لا يمكن إضافة عناصر جديدة إلى أن يُجدَّد. تواصلوا معنا لإعادة التفعيل.'
              : 'انتهت صلاحية اشتراك المكتب — لا يمكن إضافة عناصر جديدة حالياً. راجعوا مدير المكتب.'}
          </span>
          <button onClick={() => setDismissed(true)} style={{ background: 'none', border: 'none', color: '#F59E0B', cursor: 'pointer', fontSize: '1rem', flex: 'none' }} aria-label="إغلاق">✕</button>
        </div>
      )}
      {children}
    </>
  )
}
