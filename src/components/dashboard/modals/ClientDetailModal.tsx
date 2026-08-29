'use client'

import { useCallback, useEffect, useState } from 'react'
import { statusAr } from '@/lib/api'
import { Badge, DetailRow, Field, InfoLine, TabButton } from '@/components/dashboard/ui'
import { useDashboard } from '@/components/dashboard/DashboardContext'

export default function ClientDetailModal({ clientId }: { clientId?: string }) {
  const { closeModal, notifySuccess, bumpRefresh } = useDashboard()
  const [tab, setTab] = useState<'data' | 'cases' | 'invoices' | 'account'>('data')
  const [client, setClient] = useState<any>(null)
  // Initial value covers the mount fetch; callers that re-fetch
  // (createCitizenAccount) flip it themselves. Keeps setState out of the
  // effect-driven loadClient (react-hooks/set-state-in-effect).
  const [loading, setLoading] = useState(!!clientId)
  const [accEmail, setAccEmail] = useState('')
  const [accPass, setAccPass] = useState('')
  const [accLoading, setAccLoading] = useState(false)
  const [accError, setAccError] = useState('')
  const [accSuccess, setAccSuccess] = useState('')
  const [editing, setEditing] = useState(false)
  const [editForm, setEditForm] = useState({ name: '', phone: '', email: '', idNumber: '', address: '' })
  const [editBusy, setEditBusy] = useState(false)
  const [editErr, setEditErr] = useState('')

  const loadClient = useCallback(() => {
    if (!clientId) return
    fetch(`/api/clients/${clientId}`).then(r => r.json()).then(d => {
      setClient(d)
      setEditForm({ name: d.name ?? '', phone: d.phone ?? '', email: d.email ?? '', idNumber: d.idNumber ?? '', address: d.address ?? '' })
    }).catch(() => {}).finally(() => setLoading(false))
  }, [clientId])
  useEffect(() => { loadClient() }, [loadClient])

  const ef = (k: string) => (e: React.ChangeEvent<HTMLInputElement>) => setEditForm(p => ({ ...p, [k]: e.target.value }))

  async function saveEdit() {
    if (!editForm.name.trim()) return setEditErr('اسم العميل مطلوب')
    setEditBusy(true); setEditErr('')
    try {
      const res = await fetch(`/api/clients/${clientId}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(editForm),
      })
      if (!res.ok) { const d = await res.json(); setEditErr(d.error || 'خطأ في الحفظ'); return }
      setEditing(false)
      loadClient()
      bumpRefresh()
    } catch { setEditErr('تعذّر الاتصال بالخادم') } finally { setEditBusy(false) }
  }

  async function deactivate() {
    if (!window.confirm('هل أنت متأكد من إلغاء تفعيل هذا العميل؟ لن يظهر بعدها في القوائم.')) return
    setEditBusy(true); setEditErr('')
    try {
      const res = await fetch(`/api/clients/${clientId}`, { method: 'DELETE' })
      if (!res.ok) { const d = await res.json(); setEditErr(d.error || 'تعذّر إلغاء التفعيل'); return }
      notifySuccess()
    } catch { setEditErr('تعذّر الاتصال بالخادم') } finally { setEditBusy(false) }
  }

  const caseStatusBadge = (s: string): 'ac' | 'cl' | 'pe' | 'ur' => s === 'ACTIVE' ? 'ac' : s === 'CLOSED' ? 'cl' : s === 'SUSPENDED' ? 'pe' : 'ur'
  const invStatusBadge = (s: string): 'ac' | 'cl' | 'pe' | 'ur' => s === 'PAID' ? 'ac' : s === 'OVERDUE' ? 'ur' : s === 'PARTIAL' ? 'pe' : 'cl'

  async function createCitizenAccount() {
    setAccError(''); setAccSuccess(''); setAccLoading(true)
    try {
      const res = await fetch('/api/citizen/create-account', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientId, email: accEmail, password: accPass }),
      })
      const data = await res.json()
      if (!res.ok) { setAccError(data.error || 'حدث خطأ'); return }
      setAccSuccess(`تم إنشاء الحساب بنجاح — البريد: ${data.email}`)
      setAccEmail(''); setAccPass('')
      setLoading(true)
      loadClient()
    } catch { setAccError('تعذّر الاتصال بالخادم') }
    finally { setAccLoading(false) }
  }

  return (
    <div className="mbox" role="dialog" aria-modal="true" tabIndex={-1}>
      <div className="mt">👤 {loading ? 'جارٍ التحميل...' : (client?.name ?? 'العميل')} <button className="mc" onClick={closeModal} aria-label="إغلاق">✕</button></div>
      <div className="tabs">
        <TabButton active={tab === 'data'} onClick={() => setTab('data')}>البيانات</TabButton>
        <TabButton active={tab === 'cases'} onClick={() => setTab('cases')}>القضايا</TabButton>
        <TabButton active={tab === 'invoices'} onClick={() => setTab('invoices')}>الفواتير</TabButton>
        <TabButton active={tab === 'account'} onClick={() => setTab('account')}>الحساب 🌐</TabButton>
      </div>
      {loading ? <div style={{ padding: 24, color: '#94A3B8', textAlign: 'center' }}>جارٍ التحميل...</div> : !client ? <div style={{ padding: 24, color: '#F87171', textAlign: 'center' }}>تعذّر تحميل البيانات</div> : (
        <>
          {tab === 'data' && (
            <div className="tp active">
              {!editing ? (
                <>
                  <DetailRow label="الاسم" value={client.name} />
                  <DetailRow label="الهاتف" value={client.phone ?? '—'} />
                  <DetailRow label="البريد" value={client.email ?? '—'} />
                  <DetailRow label="رقم الهوية" value={client.idNumber ?? '—'} />
                  <DetailRow label="العنوان" value={client.address ?? '—'} />
                  <DetailRow label="تاريخ التسجيل" value={new Date(client.createdAt).toLocaleDateString('ar-JO')} />
                  <div style={{ marginTop: 14, display: 'flex', gap: 8 }}>
                    <button className="dbtn dbtn-s" onClick={() => setEditing(true)}>✏️ تعديل البيانات</button>
                    <button className="dbtn dbtn-d" onClick={deactivate} disabled={editBusy}>🗑️ إلغاء تفعيل العميل</button>
                  </div>
                  {editErr && <div style={{ color: '#F87171', fontSize: '.8rem', marginTop: 8 }}>⚠ {editErr}</div>}
                </>
              ) : (
                <>
                  <div className="fg">
                    <Field label="الاسم"><input className="fi" value={editForm.name} onChange={ef('name')} /></Field>
                    <Field label="الهاتف"><input className="fi" value={editForm.phone} onChange={ef('phone')} /></Field>
                    <Field label="البريد"><input className="fi" type="email" value={editForm.email} onChange={ef('email')} /></Field>
                    <Field label="رقم الهوية"><input className="fi" value={editForm.idNumber} onChange={ef('idNumber')} /></Field>
                    <Field label="العنوان" full><input className="fi" value={editForm.address} onChange={ef('address')} /></Field>
                  </div>
                  {editErr && <div style={{ color: '#F87171', fontSize: '.8rem', margin: '8px 0' }}>⚠ {editErr}</div>}
                  <div style={{ marginTop: 10, display: 'flex', gap: 8 }}>
                    <button className="dbtn dbtn-p" onClick={saveEdit} disabled={editBusy}>{editBusy ? 'جارٍ الحفظ...' : '✅ حفظ'}</button>
                    <button className="dbtn dbtn-s" onClick={() => { setEditing(false); setEditErr('') }}>إلغاء</button>
                  </div>
                </>
              )}
            </div>
          )}
          {tab === 'cases' && (
            <div className="tp active">
              {client.cases?.length === 0
                ? <div style={{ color: '#64748B', textAlign: 'center', padding: 20 }}>لا توجد قضايا</div>
                : client.cases?.map((c: any) => (
                  <InfoLine key={c.id} text={`⚖️ ${c.number} — ${c.title}`} badge={<Badge type={caseStatusBadge(c.status)}>{statusAr[c.status] ?? c.status}</Badge>} />
                ))}
            </div>
          )}
          {tab === 'invoices' && (
            <div className="tp active">
              {client.invoices?.length === 0
                ? <div style={{ color: '#64748B', textAlign: 'center', padding: 20 }}>لا توجد فواتير</div>
                : client.invoices?.map((inv: any) => (
                  <InfoLine key={inv.id} text={`🧾 ${inv.number} · ${inv.amount.toLocaleString('ar-JO')} د.أ`} badge={<Badge type={invStatusBadge(inv.status)}>{statusAr[inv.status] ?? inv.status}</Badge>} />
                ))}
            </div>
          )}
          {tab === 'account' && (
            <div className="tp active">
              {client.citizenUser ? (
                <div style={{ padding: '8px 0' }}>
                  <div style={{ background: 'rgba(16,185,129,.08)', border: '1px solid rgba(16,185,129,.2)', borderRadius: 10, padding: '14px 16px', marginBottom: 12 }}>
                    <div style={{ color: '#10B981', fontWeight: 600, marginBottom: 6 }}>✅ الحساب مفعّل</div>
                    <DetailRow label="البريد" value={client.citizenUser.email} />
                    <DetailRow label="الحالة" value={client.citizenUser.active ? 'نشط' : 'معطّل'} />
                  </div>
                  <div style={{ fontSize: '.8rem', color: '#64748B' }}>
                    يمكن للموكل الدخول على <b>بوابة المواطن</b> عبر الرابط <b>/citizen</b> بهذا البريد.
                  </div>
                </div>
              ) : (
                <div>
                  <div style={{ color: '#94A3B8', fontSize: '.85rem', marginBottom: 14 }}>
                    لا يوجد حساب إلكتروني لهذا الموكل. أنشئ له حساباً ليتمكن من متابعة قضاياه وجلساته وفواتيره.
                  </div>
                  <div className="fg">
                    <label className="fl">البريد الإلكتروني</label>
                    <input className="fi" type="email" value={accEmail} onChange={e => setAccEmail(e.target.value)} placeholder="client@example.com" />
                  </div>
                  <div className="fg">
                    <label className="fl">كلمة المرور</label>
                    <input className="fi" type="password" value={accPass} onChange={e => setAccPass(e.target.value)} placeholder="8 أحرف على الأقل" />
                  </div>
                  {accError && <div style={{ color: '#F87171', fontSize: '.82rem', marginBottom: 8 }}>⚠️ {accError}</div>}
                  {accSuccess && <div style={{ color: '#10B981', fontSize: '.82rem', marginBottom: 8 }}>✅ {accSuccess}</div>}
                  <button
                    className="sbtn"
                    disabled={accLoading || !accEmail || !accPass}
                    onClick={createCitizenAccount}
                  >
                    {accLoading ? 'جارٍ الإنشاء...' : '🌐 إنشاء حساب المواطن'}
                  </button>
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  )
}
