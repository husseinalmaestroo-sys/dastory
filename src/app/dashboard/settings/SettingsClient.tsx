'use client'

import { useCallback, useEffect, useState } from 'react'
import { Badge, Field, SectionHeader, SettingRow } from '@/components/dashboard/ui'
import { useDashboard } from '@/components/dashboard/DashboardContext'

type AuditLogItem = {
  id: string
  action: string
  actorEmail: string | null
  actorRole: string | null
  entityType: string | null
  entityId: string | null
  ipAddress: string | null
  metadata: Record<string, unknown> | null
  createdAt: string
}

function auditActionLabel(action: string) {
  const labels: Record<string, string> = {
    'auth.login_success': 'دخول ناجح',
    'auth.login_failed': 'محاولة دخول فاشلة',
    'auth.login_2fa_required': 'طلب رمز 2FA',
    'auth.2fa_login_success': 'نجاح 2FA',
    'auth.2fa_login_failed': 'فشل 2FA',
    'auth.2fa_setup_started': 'بدء إعداد 2FA',
    'auth.2fa_enabled': 'تفعيل 2FA',
    'auth.2fa_disabled': 'تعطيل 2FA',
    'auth.logout': 'تسجيل خروج',
    'auth.signup_success': 'إنشاء مكتب',
    'client.created': 'إضافة عميل',
    'client.updated': 'تعديل عميل',
    'client.deleted': 'حذف عميل',
    'case.created': 'إضافة قضية',
    'case.updated': 'تعديل قضية',
    'case.deleted': 'حذف قضية',
    'session.created': 'إضافة جلسة',
    'session.updated': 'تعديل جلسة',
    'session.deleted': 'حذف جلسة',
    'invoice.created': 'إضافة فاتورة',
    'invoice.updated': 'تعديل فاتورة',
    'invoice.deleted': 'حذف فاتورة',
    'document.uploaded': 'رفع مستند',
    'team.member_created': 'إضافة عضو',
    'team.member_updated': 'تعديل عضو',
    'citizen.account_created': 'إنشاء حساب موكل',
    'email.sent': 'إرسال بريد',
    'email.send_failed': 'فشل إرسال بريد',
  }
  return labels[action] ?? action
}

function formatAuditMeta(metadata: AuditLogItem['metadata']) {
  if (!metadata || typeof metadata !== 'object') return '—'
  if (Array.isArray(metadata.fields)) return `حقول: ${metadata.fields.join(', ')}`
  if (typeof metadata.reason === 'string') return `سبب: ${metadata.reason}`
  if (typeof metadata.status === 'string') return `حالة: ${metadata.status}`
  if (typeof metadata.type === 'string') return `نوع: ${metadata.type}`

  const entries = Object.entries(metadata).slice(0, 3)
  if (entries.length === 0) return '—'
  return entries.map(([key, value]) => `${key}: ${String(value)}`).join('، ')
}

export default function SettingsClient({
  initialTwoFactorEnabled, initialEmailVerified, email,
}: { initialTwoFactorEnabled: boolean; initialEmailVerified: boolean; email: string }) {
  const { isAdmin } = useDashboard()
  // Not local state: verification only ever completes on the separate
  // /login/verify-email page (the emailed link), never on this page, so
  // there is nothing that would update it in place — the banner reflects
  // the server-rendered value until the next navigation/reload.
  const emailVerified = initialEmailVerified
  const [resendBusy, setResendBusy] = useState(false)
  const [resendMessage, setResendMessage] = useState('')
  const [resendError, setResendError] = useState('')
  const [security, setSecurity] = useState({ enabled: initialTwoFactorEnabled, setupPending: false })
  const [setup, setSetup] = useState<{ manualKey: string; otpauthUrl: string } | null>(null)
  const [enableCode, setEnableCode] = useState('')
  const [disableCode, setDisableCode] = useState('')
  const [securityBusy, setSecurityBusy] = useState<'start' | 'enable' | 'disable' | ''>('')
  const [securityError, setSecurityError] = useState('')
  const [securityMessage, setSecurityMessage] = useState('')
  const [auditLogs, setAuditLogs] = useState<AuditLogItem[]>([])
  // Starts true for an admin (the mount effect fetches immediately) so there
  // is no synchronous setAuditLoading(true) inside that effect
  // (react-hooks/set-state-in-effect); later manual reloads refresh in place.
  const [auditLoading, setAuditLoading] = useState(isAdmin)

  const loadAuditLogs = useCallback(async () => {
    if (!isAdmin) return
    try {
      const res = await fetch('/api/audit-logs?limit=50')
      if (!res.ok) return
      const data = await res.json()
      if (Array.isArray(data)) setAuditLogs(data)
    } catch {
    } finally {
      setAuditLoading(false)
    }
  }, [isAdmin])

  const [billing, setBilling] = useState<{ status: string; planName: string | null; daysLeftInTrial: number | null; paymentProviderConnected: boolean } | null>(null)
  useEffect(() => {
    if (!isAdmin) return
    fetch('/api/billing/status').then(r => r.ok ? r.json() : null).then(setBilling).catch(() => {})
  }, [isAdmin])

  useEffect(() => {
    let alive = true
    fetch('/api/auth/2fa')
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (!alive || !data) return
        setSecurity({ enabled: Boolean(data.enabled), setupPending: Boolean(data.setupPending) })
      })
      .catch(() => {})

    // Audit logs fetched inline (setState only in the promise callbacks, not
    // synchronously in the effect body — react-hooks/set-state-in-effect).
    // loadAuditLogs() itself stays for the post-action manual refreshes below.
    if (isAdmin) {
      fetch('/api/audit-logs?limit=50')
        .then(r => (r.ok ? r.json() : null))
        .then(data => { if (alive && Array.isArray(data)) setAuditLogs(data) })
        .catch(() => {})
        .finally(() => { if (alive) setAuditLoading(false) })
    }
    return () => { alive = false }
  }, [isAdmin])

  async function startTwoFactor() {
    setSecurityBusy('start')
    setSecurityError('')
    setSecurityMessage('')
    try {
      const res = await fetch('/api/auth/2fa', { method: 'POST' })
      const data = await res.json()
      if (!res.ok) { setSecurityError(data.error || 'تعذر بدء الإعداد'); return }
      setSetup(data)
      setSecurity({ enabled: false, setupPending: true })
      setSecurityMessage('أضف المفتاح في تطبيق المصادقة ثم أدخل الرمز الأول.')
      loadAuditLogs()
    } catch {
      setSecurityError('تعذر الاتصال بالخادم')
    } finally {
      setSecurityBusy('')
    }
  }

  async function enableTwoFactor() {
    if (!enableCode.trim()) { setSecurityError('أدخل رمز التحقق'); return }
    setSecurityBusy('enable')
    setSecurityError('')
    setSecurityMessage('')
    try {
      const res = await fetch('/api/auth/2fa', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: enableCode.trim() }),
      })
      const data = await res.json()
      if (!res.ok) { setSecurityError(data.error || 'تعذر تفعيل المصادقة الثنائية'); return }
      setSetup(null)
      setEnableCode('')
      setSecurity({ enabled: true, setupPending: false })
      setSecurityMessage('تم تفعيل المصادقة الثنائية لهذا الحساب.')
      loadAuditLogs()
    } catch {
      setSecurityError('تعذر الاتصال بالخادم')
    } finally {
      setSecurityBusy('')
    }
  }

  async function disableTwoFactor() {
    if (!disableCode.trim()) { setSecurityError('أدخل رمز التحقق الحالي'); return }
    setSecurityBusy('disable')
    setSecurityError('')
    setSecurityMessage('')
    try {
      const res = await fetch('/api/auth/2fa', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: disableCode.trim() }),
      })
      const data = await res.json()
      if (!res.ok) { setSecurityError(data.error || 'تعذر تعطيل المصادقة الثنائية'); return }
      setDisableCode('')
      setSetup(null)
      setSecurity({ enabled: false, setupPending: false })
      setSecurityMessage('تم تعطيل المصادقة الثنائية لهذا الحساب.')
      loadAuditLogs()
    } catch {
      setSecurityError('تعذر الاتصال بالخادم')
    } finally {
      setSecurityBusy('')
    }
  }

  async function resendVerification() {
    setResendBusy(true); setResendError(''); setResendMessage('')
    try {
      const res = await fetch('/api/auth/verify-email/resend', { method: 'POST' })
      const data = await res.json()
      if (!res.ok) { setResendError(data.error || 'تعذر إرسال رابط التأكيد'); return }
      setResendMessage(data.message || 'تم إرسال رابط تأكيد جديد')
    } catch {
      setResendError('تعذر الاتصال بالخادم')
    } finally {
      setResendBusy(false)
    }
  }

  return (
    <div className="pg">
      <SectionHeader title="الأمان والإعدادات" subtitle="المصادقة الثنائية وسجل نشاط المكتب" />

      {!emailVerified && (
        <div className="card" style={{ marginBottom: 14, border: '1px solid rgba(245,158,11,.3)', background: 'rgba(245,158,11,.06)' }}>
          <div className="ct">✉️ تأكيد البريد الإلكتروني</div>
          <div style={{ fontSize: '.82rem', color: '#CBD5E1', lineHeight: 1.8, marginBottom: 10 }}>
            لم يتم تأكيد بريدك الإلكتروني ({email}) بعد. بعض الإجراءات (مثل إرسال رسائل من داخل المنصة) تتطلب تأكيد البريد أولاً.
          </div>
          <button className="dbtn dbtn-p" onClick={resendVerification} disabled={resendBusy}>
            {resendBusy ? 'جارٍ الإرسال...' : '📤 إرسال رابط تأكيد'}
          </button>
          {resendMessage && <div style={{ color: '#10B981', fontSize: '.8rem', marginTop: 8 }}>{resendMessage}</div>}
          {resendError && <div style={{ color: '#F87171', fontSize: '.8rem', marginTop: 8 }}>⚠ {resendError}</div>}
        </div>
      )}

      <div className="g2">
        <div className="card">
          <div className="ct">🔐 المصادقة الثنائية</div>
          <SettingRow
            title="حالة 2FA"
            sub={security.enabled ? 'سيُطلب رمز تحقق بعد كلمة المرور.' : 'يمكن تفعيلها من تطبيق Google Authenticator أو Microsoft Authenticator.'}
            right={security.enabled ? <Badge type="ac">● مفعلة</Badge> : security.setupPending ? <Badge type="pe">● إعداد معلق</Badge> : <Badge type="cl">● غير مفعلة</Badge>}
            accent={security.enabled ? 'rgba(16,185,129,.07)' : 'rgba(255,255,255,.03)'}
            border={security.enabled ? 'rgba(16,185,129,.16)' : 'transparent'}
          />

          {!security.enabled && !setup && (
            <button className="dbtn dbtn-p" onClick={startTwoFactor} disabled={securityBusy === 'start'} style={{ marginTop: 12 }}>
              {securityBusy === 'start' ? 'جارٍ التجهيز...' : 'بدء إعداد 2FA'}
            </button>
          )}

          {setup && (
            <div className="ar" style={{ marginTop: 12 }}>
              <div style={{ fontSize: '.78rem', color: '#94A3B8', marginBottom: 8 }}>المفتاح اليدوي</div>
              <div style={{ direction: 'ltr', textAlign: 'left', fontFamily: 'monospace', color: '#E2E8F0', background: 'rgba(0,0,0,.18)', borderRadius: 8, padding: 10, wordBreak: 'break-all' }}>
                {setup.manualKey}
              </div>
              <a className="dbtn dbtn-s" href={setup.otpauthUrl} style={{ marginTop: 10, textDecoration: 'none' }}>فتح في تطبيق المصادقة</a>
              <div className="fg" style={{ marginTop: 12 }}>
                <Field label="رمز التحقق">
                  <input className="fi" value={enableCode} onChange={(e) => setEnableCode(e.target.value)} inputMode="numeric" maxLength={6} placeholder="123456" />
                </Field>
                <div style={{ display: 'flex', alignItems: 'end' }}>
                  <button className="dbtn dbtn-g" onClick={enableTwoFactor} disabled={securityBusy === 'enable'}>
                    {securityBusy === 'enable' ? 'جارٍ التفعيل...' : 'تفعيل 2FA'}
                  </button>
                </div>
              </div>
            </div>
          )}

          {security.enabled && (
            <div className="fg" style={{ marginTop: 12 }}>
              <Field label="رمز التعطيل">
                <input className="fi" value={disableCode} onChange={(e) => setDisableCode(e.target.value)} inputMode="numeric" maxLength={6} placeholder="123456" />
              </Field>
              <div style={{ display: 'flex', alignItems: 'end' }}>
                <button className="dbtn dbtn-d" onClick={disableTwoFactor} disabled={securityBusy === 'disable'}>
                  {securityBusy === 'disable' ? 'جارٍ التعطيل...' : 'تعطيل 2FA'}
                </button>
              </div>
            </div>
          )}

          {securityError && <div style={{ color: '#F87171', fontSize: '.8rem', marginTop: 10 }}>{securityError}</div>}
          {securityMessage && <div style={{ color: '#10B981', fontSize: '.8rem', marginTop: 10 }}>{securityMessage}</div>}
        </div>

        <div className="card">
          <div className="ct">🛡️ حماية الجلسة</div>
          <SettingRow title="التحقق من حالة الحساب" sub="كل طلب API يتأكد أن المستخدم والمكتب نشطان." right={<Badge type="ac">● فعال</Badge>} />
          <div style={{ height: 10 }} />
          <SettingRow title="إبطال الجلسات" sub="تغيير كلمة المرور أو 2FA يرفع إصدار الجلسة." right={<Badge type="ac">● فعال</Badge>} />
          <div style={{ height: 10 }} />
          <SettingRow title="عزل المكتب" sub="البيانات والسجلات تُعرض ضمن المكتب الحالي فقط." right={<Badge type="ac">● فعال</Badge>} />
        </div>
      </div>

      {isAdmin && (
        <div className="card" style={{ marginTop: 14 }}>
          <div className="ct">📋 سجل التدقيق</div>
          {auditLoading ? (
            <div style={{ padding: 18, textAlign: 'center', color: '#94A3B8' }}>جارٍ تحميل السجل...</div>
          ) : auditLogs.length === 0 ? (
            <div style={{ padding: 18, textAlign: 'center', color: '#94A3B8' }}>لا توجد أحداث مسجلة بعد.</div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table className="dt">
                <thead>
                  <tr><th>الوقت</th><th>الحدث</th><th>المستخدم</th><th>العنصر</th><th>تفاصيل</th><th>IP</th></tr>
                </thead>
                <tbody>
                  {auditLogs.map((log) => (
                    <tr key={log.id}>
                      <td>{new Date(log.createdAt).toLocaleString('ar-JO')}</td>
                      <td>{auditActionLabel(log.action)}</td>
                      <td>{log.actorEmail ?? '—'}</td>
                      <td>{log.entityType ? `${log.entityType} · ${log.entityId ?? '—'}` : '—'}</td>
                      <td>{formatAuditMeta(log.metadata)}</td>
                      <td>{log.ipAddress ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {isAdmin && billing && (
        <div className="card" style={{ marginTop: 14 }}>
          <div className="ct">💳 حالة الاشتراك</div>
          {!billing.paymentProviderConnected && (
            <div style={{ background: 'rgba(245,158,11,.07)', border: '1px solid rgba(245,158,11,.2)', borderRadius: 9, padding: '10px 12px', marginBottom: 12, fontSize: '.78rem', color: '#F59E0B' }}>
              ⚠️ الفوترة غير متصلة بمزود دفع فعلي بعد — هذا عرض لحالة الخطة فقط، ولا يتم تحصيل أي مبلغ حالياً.
            </div>
          )}
          <SettingRow
            title={billing.planName ?? 'لا توجد خطة'}
            sub={billing.status === 'TRIALING' && billing.daysLeftInTrial !== null
              ? `فترة تجريبية — ${billing.daysLeftInTrial} يوم متبقٍ`
              : billing.status === 'NONE' ? 'لم يتم تفعيل أي خطة لهذا المكتب' : `الحالة: ${billing.status}`}
            right={<Badge type={billing.status === 'ACTIVE' ? 'ac' : billing.status === 'TRIALING' ? 'pe' : 'cl'}>{billing.status}</Badge>}
          />
        </div>
      )}

      {isAdmin && (
        <div className="card" style={{ marginTop: 14 }}>
          <div className="ct">📦 تصدير بيانات المكتب</div>
          <div style={{ fontSize: '.8rem', color: '#94A3B8', lineHeight: 1.8, marginBottom: 12 }}>
            نسخة كاملة من بيانات المكتب (العملاء، القضايا، الجلسات، الفواتير، والمستندات بملفاتها) بصيغة ملف مضغوط.
            نسخة للحظتها فقط — لا تُحذف أي بيانات ولا يمكن إعادة استيرادها.
          </div>
          <a
            href="/api/office/export"
            className="dbtn dbtn-p"
            style={{ display: 'inline-block', textDecoration: 'none' }}
          >
            ⬇ تنزيل نسخة البيانات
          </a>
        </div>
      )}

      {isAdmin && <PermissionsMatrix />}
    </div>
  )
}

function PermissionsMatrix() {
  return (
    <div style={{ marginTop: 14 }}>
      <SectionHeader title="صلاحيات المستخدمين" subtitle="الأدوار الفعلية الموجودة بالنظام — مُطبَّقة على مستوى الخادم لا الواجهة فقط" />
      <div className="card">
        <div className="ct">🔐 مصفوفة الصلاحيات</div>
        <table className="pt">
          <tbody>
            <tr><th>الوحدة</th><th>مدير المكتب</th><th>محامٍ</th><th>الموكّل (بوابة العميل)</th></tr>
            {[
              ['لوحة التحكم', '✓ كل بيانات المكتب', '✓ بياناته فقط', '✓ بوابة منفصلة'],
              ['إدارة العملاء', '✓ الكل', '✓ عملاؤه + من له قضية معهم', '—'],
              ['إدارة القضايا', '✓ الكل', '✓ قضاياه فقط', 'عرض قضاياه فقط'],
              ['الجلسات والفواتير', '✓ الكل', '✓ المرتبطة بقضاياه فقط', 'عرض فقط'],
              ['الملفات والمستندات', '✓ الكل', '✓ ملفاته وملفات قضاياه فقط', '—'],
              ['إدارة الفريق', '✓', '—', '—'],
              ['التقارير الكاملة وسجل التدقيق', '✓', '—', '—'],
              ['النسخ الاحتياطي', 'الواجهة جاهزة، التفعيل يحتاج ربط مزود تخزين', '—', '—'],
            ].map(([name, ...cells]) => (
              <tr key={name}>
                <td>{name}</td>
                {cells.map((cell, index) => <td key={index}><span className={cell.startsWith('✓') ? 'pck' : 'pxm'}>{cell}</span></td>)}
              </tr>
            ))}
          </tbody>
        </table>
        <div style={{ marginTop: 10, fontSize: '.76rem', color: '#64748B', lineHeight: 1.8 }}>
          لا توجد أدوار "سكرتير" أو "محاسب" أو "متدرب" بالنظام حالياً — الأدوار المتاحة فعلياً هي مدير المكتب والمحامي والموكّل فقط.
        </div>
      </div>
    </div>
  )
}
