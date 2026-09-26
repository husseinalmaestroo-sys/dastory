'use client'

import { useEffect, useState } from 'react'
import { Badge, ErrorState, SectionHeader, StatCard } from '@/components/dashboard/ui'
import { apiFetch, errorMessage } from '@/lib/dashboard/api-client'
import { useDashboard } from '@/components/dashboard/DashboardContext'
import { PermissionsMatrix } from '@/components/dashboard/PermissionsMatrix'

interface TeamMember {
  id: string
  name: string
  email: string
  role: string
  active: boolean
  _count: { cases: number }
}

function roleLabel(role: string) {
  if (role === 'OFFICE_MANAGER') return 'مدير المكتب'
  if (role === 'LAWYER') return 'محامٍ'
  if (role === 'CITIZEN') return 'مواطن'
  return role
}

function roleBadge(role: string): 'go' | 'bl' | 'pu' | 'cl' | 'pe' {
  if (role === 'OFFICE_MANAGER') return 'go'
  if (role === 'CITIZEN') return 'pu'
  return 'bl'
}

function RestrictedNotice() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: 340, gap: 12, color: '#64748B', textAlign: 'center', padding: 40 }}>
      <div style={{ fontSize: '3rem' }}>🔒</div>
      <div style={{ fontSize: '1.1rem', fontWeight: 800, color: '#94A3B8' }}>صلاحية محدودة</div>
      <div style={{ fontSize: '.85rem', maxWidth: 320, lineHeight: 1.8 }}>إدارة الفريق متاحة لمدير المكتب فقط. تواصل مع المدير إذا كنت تحتاج للوصول.</div>
    </div>
  )
}

export default function TeamPage() {
  const { isAdmin } = useDashboard()
  if (!isAdmin) return <RestrictedNotice />
  return <TeamPageContent />
}

function TeamPageContent() {
  const [team, setTeam] = useState<TeamMember[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [actionError, setActionError] = useState('')
  const [reloadKey, setReloadKey] = useState(0)
  const [showAdd, setShowAdd] = useState(false)
  const [pwdFor, setPwdFor]   = useState<string | null>(null)
  const [newPwd, setNewPwd]   = useState('')
  const [showNewPwd, setShowNewPwd] = useState(false)
  const [form, setForm] = useState({ name: '', email: '', password: '', confirmPwd: '' })
  const [formErr, setFormErr] = useState('')
  const [formBusy, setFormBusy] = useState(false)
  const [showPwd, setShowPwd] = useState(false)

  useEffect(() => {
    let cancelled = false
    apiFetch<TeamMember[]>('/api/team')
      .then(({ data }) => { if (!cancelled && Array.isArray(data)) { setTeam(data); setLoadError('') } })
      .catch((err) => { if (!cancelled) setLoadError(errorMessage(err)) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [reloadKey])

  async function toggleActive(id: string, current: boolean) {
    setActionError('')
    // Optimistic — but reverted if the server refuses, so the switch never
    // shows a state the account isn't actually in.
    setTeam(t => t.map(m => m.id === id ? { ...m, active: !current } : m))
    try {
      await apiFetch('/api/team', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, active: !current }) })
    } catch (err) {
      setTeam(t => t.map(m => m.id === id ? { ...m, active: current } : m))
      setActionError(errorMessage(err))
    }
  }

  async function changePassword(id: string) {
    if (!newPwd.trim() || newPwd.length < 8) { alert('كلمة المرور يجب أن تكون 8 أحرف على الأقل'); return }
    await fetch('/api/team', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, password: newPwd }) })
    setPwdFor(null); setNewPwd('')
  }

  async function addMember() {
    setFormErr('')
    if (!form.name.trim()) return setFormErr('يرجى إدخال الاسم الكامل')
    if (!form.email.trim() || !form.email.includes('@')) return setFormErr('يرجى إدخال بريد إلكتروني صحيح')
    if (form.password.length < 8) return setFormErr('كلمة المرور يجب أن تكون 8 أحرف على الأقل')
    if (form.password !== form.confirmPwd) return setFormErr('كلمتا المرور غير متطابقتين')
    setFormBusy(true)
    const res = await fetch('/api/team', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: form.name, email: form.email, password: form.password }) })
    const data = await res.json()
    setFormBusy(false)
    if (!res.ok) return setFormErr(data.error || 'خطأ في الإضافة')
    setTeam(t => [data, ...t])
    setForm({ name: '', email: '', password: '', confirmPwd: '' })
    setShowAdd(false)
  }

  const activeCount   = team.filter(m => m.active).length
  const inactiveCount = team.filter(m => !m.active).length

  return (
    <div className="pg">
      <SectionHeader title="إدارة الفريق" subtitle={loading ? 'جاري التحميل...' : `${team.length} أعضاء — ${activeCount} نشط، ${inactiveCount} موقوف`}>
        <button className="dbtn dbtn-p" onClick={() => setShowAdd(true)}>+ دعوة محامٍ</button>
      </SectionHeader>
      {loadError && <ErrorState message={loadError} onRetry={() => { setLoading(true); setReloadKey((k) => k + 1) }} />}
      {actionError && <ErrorState message={actionError} />}

      <div className="sg" style={{ marginBottom: 16 }}>
        <StatCard icon="👥" value={loading ? '...' : String(team.length)}   label="إجمالي الفريق" />
        <StatCard icon="🟢" value={loading ? '...' : String(activeCount)}   label="أعضاء نشطون" />
        <StatCard icon="⏸️" value={loading ? '...' : String(inactiveCount)} label="أعضاء موقوفون" />
        <StatCard icon="⚖️" value={loading ? '...' : String(team.filter(m => m.role === 'LAWYER').length)} label="المحامون" />
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="ct">👥 أعضاء الفريق وبيانات الدخول</div>
        <div style={{ overflowX: 'auto' }}>
          <table className="dt" style={{ minWidth: 680 }}>
            <tbody>
              <tr>
                <th>الاسم</th>
                <th>البريد الإلكتروني</th>
                <th>الدور</th>
                <th>القضايا</th>
                <th>الحالة</th>
                <th>الإجراءات</th>
              </tr>
              {loading ? (
                <tr><td colSpan={6} style={{ textAlign: 'center', color: '#64748B', padding: 20 }}>جاري التحميل...</td></tr>
              ) : team.map(m => (
                <tr key={m.id} style={{ opacity: m.active ? 1 : .55 }}>
                  <td><b>{m.name}</b></td>
                  <td>
                    <code style={{ fontSize: '.75rem', background: 'rgba(255,255,255,.06)', padding: '2px 8px', borderRadius: 5, color: '#94A3B8', fontFamily: 'monospace' }}>
                      {m.email}
                    </code>
                  </td>
                  <td><Badge type={roleBadge(m.role)}>{roleLabel(m.role)}</Badge></td>
                  <td style={{ color: '#94A3B8' }}>{m._count.cases > 0 ? `${m._count.cases} قضية` : '—'}</td>
                  <td>
                    <button
                      onClick={() => toggleActive(m.id, m.active)}
                      style={{
                        display: 'inline-flex', alignItems: 'center', gap: 6,
                        padding: '3px 10px', borderRadius: 20, border: 'none', cursor: 'pointer',
                        fontFamily: "'Cairo', sans-serif", fontSize: '.72rem', fontWeight: 700,
                        background: m.active ? 'rgba(16,185,129,.12)' : 'rgba(239,68,68,.12)',
                        color: m.active ? '#10B981' : '#F87171',
                      }}
                    >
                      <span style={{ width: 7, height: 7, borderRadius: '50%', background: m.active ? '#10B981' : '#EF4444', display: 'inline-block', flexShrink: 0 }} />
                      {m.active ? 'نشط' : 'موقوف'}
                    </button>
                  </td>
                  <td>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      <button className="dbtn dbtn-s" style={{ padding: '3px 9px', fontSize: '.7rem' }} onClick={() => toggleActive(m.id, m.active)}>
                        {m.active ? '⏸ إيقاف' : '▶ تفعيل'}
                      </button>
                      <button className="dbtn dbtn-s" style={{ padding: '3px 9px', fontSize: '.7rem' }} onClick={() => { setPwdFor(m.id); setNewPwd('') }}>
                        🔑 تغيير كلمة المرور
                      </button>
                    </div>
                    {pwdFor === m.id && (
                      <div style={{ marginTop: 8, display: 'flex', gap: 6, alignItems: 'center' }}>
                        <div style={{ position: 'relative', flex: 1 }}>
                          <input
                            type={showNewPwd ? 'text' : 'password'}
                            value={newPwd}
                            onChange={e => setNewPwd(e.target.value)}
                            placeholder="كلمة المرور الجديدة..."
                            className="fi"
                            style={{ paddingLeft: 32, width: '100%', fontSize: '.78rem' }}
                            onKeyDown={e => e.key === 'Enter' && changePassword(m.id)}
                          />
                          <button onClick={() => setShowNewPwd(v => !v)} aria-label={showNewPwd ? 'إخفاء كلمة المرور' : 'إظهار كلمة المرور'} style={{ position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: '#64748B', fontSize: '.8rem', padding: 0 }}>
                            {showNewPwd ? '🙈' : '👁'}
                          </button>
                        </div>
                        <button className="dbtn dbtn-p" style={{ padding: '5px 12px', fontSize: '.74rem', flexShrink: 0 }} onClick={() => changePassword(m.id)}>حفظ</button>
                        <button className="dbtn dbtn-s" style={{ padding: '5px 10px', fontSize: '.74rem', flexShrink: 0 }} onClick={() => { setPwdFor(null); setNewPwd('') }}>إلغاء</button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <PermissionsMatrix />

      {showAdd && (
        <div className="mo" onClick={e => e.target === e.currentTarget && setShowAdd(false)}>
          <div className="mbox" style={{ maxWidth: 480 }}>
            <div className="mt">
              <span>➕ دعوة محامٍ جديد</span>
              <button onClick={() => setShowAdd(false)} style={{ background: 'none', border: 'none', color: '#64748B', cursor: 'pointer', fontSize: '1.2rem' }}>✕</button>
            </div>
            <div className="mc" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div>
                <label style={{ display: 'block', fontSize: '.8rem', color: '#94A3B8', marginBottom: 6, fontWeight: 700 }}>الاسم الكامل *</label>
                <input className="fi" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="مثال: أحمد محمد الحسين" />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '.8rem', color: '#94A3B8', marginBottom: 6, fontWeight: 700 }}>البريد الإلكتروني *</label>
                <input className="fi" type="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value.toLowerCase() }))} placeholder="ahmed@lawfirm.jo" style={{ direction: 'ltr', textAlign: 'left' }} />
              </div>
              <div style={{ fontSize: '.78rem', color: '#94A3B8', lineHeight: 1.8, background: 'rgba(37,99,235,.07)', border: '1px solid rgba(37,99,235,.18)', borderRadius: 10, padding: '10px 12px' }}>
                سيتم إنشاء الحساب كمحامٍ داخل نفس مكتبك. صلاحيات مدير المكتب لا تُمنح من شاشة الدعوة.
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '.8rem', color: '#94A3B8', marginBottom: 6, fontWeight: 700 }}>كلمة المرور *</label>
                <div style={{ position: 'relative' }}>
                  <input type={showPwd ? 'text' : 'password'} className="fi" value={form.password} onChange={e => setForm(f => ({ ...f, password: e.target.value }))} placeholder="8 أحرف على الأقل" style={{ paddingLeft: 36, width: '100%' }} />
                  <button onClick={() => setShowPwd(v => !v)} aria-label={showPwd ? 'إخفاء كلمة المرور' : 'إظهار كلمة المرور'} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: '#64748B', fontSize: '.9rem', padding: 0 }}>{showPwd ? '🙈' : '👁'}</button>
                </div>
                {form.password && (
                  <div style={{ marginTop: 6, display: 'flex', gap: 4 }}>
                    {[1,2,3,4].map(n => (
                      <div key={n} style={{ flex: 1, height: 3, borderRadius: 2, background: form.password.length >= n * 3 ? (form.password.length >= 10 ? '#10B981' : form.password.length >= 7 ? '#F59E0B' : '#EF4444') : 'rgba(255,255,255,.08)' }} />
                    ))}
                    <span style={{ fontSize: '.68rem', color: form.password.length >= 10 ? '#10B981' : form.password.length >= 7 ? '#F59E0B' : '#EF4444', whiteSpace: 'nowrap' }}>
                      {form.password.length >= 10 ? 'قوية' : form.password.length >= 7 ? 'متوسطة' : 'ضعيفة'}
                    </span>
                  </div>
                )}
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '.8rem', color: '#94A3B8', marginBottom: 6, fontWeight: 700 }}>تأكيد كلمة المرور *</label>
                <input type="password" className="fi" value={form.confirmPwd} onChange={e => setForm(f => ({ ...f, confirmPwd: e.target.value }))} placeholder="أعد إدخال كلمة المرور" />
                {form.confirmPwd && form.password !== form.confirmPwd && (
                  <div style={{ fontSize: '.72rem', color: '#F87171', marginTop: 4 }}>⚠ كلمتا المرور غير متطابقتين</div>
                )}
              </div>
              {form.name && form.email && (
                <div style={{ background: 'rgba(16,185,129,.06)', border: '1px solid rgba(16,185,129,.15)', borderRadius: 10, padding: '12px 14px', fontSize: '.8rem' }}>
                  <div style={{ fontWeight: 800, color: '#10B981', marginBottom: 8 }}>✅ بيانات الدخول</div>
                  <div style={{ color: '#94A3B8', display: 'flex', flexDirection: 'column', gap: 4 }}>
                    <div>الاسم: <b style={{ color: '#E2E8F0' }}>{form.name}</b></div>
                    <div>البريد: <code style={{ color: '#60A5FA', fontFamily: 'monospace' }}>{form.email}</code></div>
                    <div>الدور: <b style={{ color: '#E2E8F0' }}>محامٍ</b></div>
                  </div>
                </div>
              )}
              {formErr && (
                <div style={{ background: 'rgba(239,68,68,.08)', border: '1px solid rgba(239,68,68,.2)', borderRadius: 9, padding: '10px 14px', color: '#F87171', fontSize: '.8rem', fontWeight: 700 }}>
                  ⚠ {formErr}
                </div>
              )}
            </div>
            <div className="mact" style={{ display: 'flex', gap: 10, padding: '14px 20px', justifyContent: 'flex-end' }}>
              <button className="dbtn dbtn-s" onClick={() => { setShowAdd(false); setFormErr('') }}>إلغاء</button>
              <button className="dbtn dbtn-p" onClick={addMember} disabled={formBusy}>{formBusy ? 'جاري الحفظ...' : '✅ إنشاء الدعوة'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

