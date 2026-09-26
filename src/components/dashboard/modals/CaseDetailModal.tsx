'use client'

import { useCallback, useEffect, useState } from 'react'
import { apiFetch, errorMessage } from '@/lib/dashboard/api-client'
import { fmtDate, statusAr } from '@/lib/api'
import { Badge, DetailRow, Field, InfoLine, TabButton, TimelineItem } from '@/components/dashboard/ui'
import { useDashboard } from '@/components/dashboard/DashboardContext'

export default function CaseDetailModal({ caseId }: { caseId?: string }) {
  const { closeModal, notifySuccess, bumpRefresh, isAdmin } = useDashboard()
  const [tab, setTab] = useState<'details' | 'sessions' | 'files'>('details')
  const [c, setC] = useState<any>(null)
  // Initial value covers the mount fetch; callers that re-fetch (saveEdit)
  // flip it themselves. Keeps setState out of the effect-driven loadCase
  // (react-hooks/set-state-in-effect).
  const [loading, setLoading] = useState(!!caseId)
  const [editing, setEditing] = useState(false)
  const [lawyers, setLawyers] = useState<any[]>([])
  const [editForm, setEditForm] = useState({ number: '', title: '', type: '', court: '', notes: '', status: 'ACTIVE', lawyerId: '' })
  const [editBusy, setEditBusy] = useState(false)
  const [editErr, setEditErr] = useState('')
  const [loadErr, setLoadErr] = useState('')

  const loadCase = useCallback(() => {
    if (!caseId) return
    // A 404/403 body ({error}) used to be stored as if it were the case.
    apiFetch<any>(`/api/cases/${caseId}`).then(({ data: d }) => {
      setC(d)
      setLoadErr('')
      setEditForm({
        number: d.number ?? '', title: d.title ?? '', type: d.type ?? '', court: d.court ?? '',
        notes: d.notes ?? '', status: d.status ?? 'ACTIVE', lawyerId: d.lawyer?.id ?? '',
      })
    }).catch((e) => { setC(null); setLoadErr(errorMessage(e)) }).finally(() => setLoading(false))
  }, [caseId])
  useEffect(() => { loadCase() }, [loadCase])
  useEffect(() => {
    if (!isAdmin) return
    apiFetch<any[]>('/api/team').then(({ data }) => { if (Array.isArray(data)) setLawyers(data) }).catch((e) => setEditErr(`تعذّر تحميل قائمة المحامين: ${errorMessage(e)}`))
  }, [isAdmin])

  const ef = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setEditForm(p => ({ ...p, [k]: e.target.value }))

  async function saveEdit() {
    if (!editForm.number.trim() || !editForm.title.trim() || !editForm.type.trim()) return setEditErr('رقم القضية وعنوانها ونوعها مطلوبة')
    setEditBusy(true); setEditErr('')
    try {
      const payload: Record<string, unknown> = {
        number: editForm.number, title: editForm.title, type: editForm.type,
        court: editForm.court, notes: editForm.notes, status: editForm.status,
      }
      if (isAdmin) payload.lawyerId = editForm.lawyerId || null
      const res = await fetch(`/api/cases/${caseId}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
      })
      if (!res.ok) { const d = await res.json(); setEditErr(d.error || 'خطأ في الحفظ'); return }
      setEditing(false)
      setLoading(true)
      loadCase()
      bumpRefresh()
    } catch { setEditErr('تعذّر الاتصال بالخادم') } finally { setEditBusy(false) }
  }

  async function del() {
    if (!window.confirm('هل أنت متأكد من حذف هذه القضية؟ سيتم حذف جلساتها وفواتيرها ومستنداتها المرتبطة.')) return
    setEditBusy(true); setEditErr('')
    try {
      const res = await fetch(`/api/cases/${caseId}`, { method: 'DELETE' })
      if (!res.ok) { const d = await res.json(); setEditErr(d.error || 'تعذّر الحذف'); return }
      notifySuccess()
    } catch { setEditErr('تعذّر الاتصال بالخادم') } finally { setEditBusy(false) }
  }

  const nextSession = c?.sessions?.find((s: any) => s.status === 'UPCOMING')

  return (
    <div className="mbox" style={{ width: 600 }} role="dialog" aria-modal="true" tabIndex={-1}>
      <div className="mt">⚖️ {loading ? 'جارٍ التحميل...' : (c ? `${c.number} — ${c.title}` : 'القضية')} <button className="mc" onClick={closeModal} aria-label="إغلاق">✕</button></div>
      <div className="tabs">
        <TabButton active={tab === 'details'} onClick={() => setTab('details')}>التفاصيل</TabButton>
        <TabButton active={tab === 'sessions'} onClick={() => setTab('sessions')}>الجلسات</TabButton>
        <TabButton active={tab === 'files'} onClick={() => setTab('files')}>الملفات</TabButton>
      </div>
      {loading ? <div style={{ padding: 24, color: '#94A3B8', textAlign: 'center' }}>جارٍ التحميل...</div> : !c ? <div role="alert" style={{ padding: 24, color: '#F87171', textAlign: 'center' }}>⚠️ {loadErr || 'تعذّر تحميل البيانات'}</div> : (
        <>
          {tab === 'details' && (
            <div className="tp active">
              {!editing ? (
                <>
                  <DetailRow label="رقم القضية" value={c.number} />
                  <DetailRow label="العنوان" value={c.title} />
                  <DetailRow label="النوع" value={c.type ?? '—'} />
                  <DetailRow label="الموكل" value={c.client?.name ?? '—'} />
                  <DetailRow label="المحامي" value={c.lawyer?.name ?? '—'} />
                  <DetailRow label="المحكمة" value={c.court ?? '—'} />
                  <div className="arr"><span className="lb">الحالة</span><span className="vl"><Badge type={c.status === 'ACTIVE' ? 'ac' : c.status === 'CLOSED' ? 'cl' : 'pe'}>{statusAr[c.status] ?? c.status}</Badge></span></div>
                  {nextSession && <DetailRow label="الجلسة القادمة" value={`${fmtDate(nextSession.date)} · ${nextSession.time}`} />}
                  {c.notes && <DetailRow label="ملاحظات" value={c.notes} />}
                  <div style={{ marginTop: 14, display: 'flex', gap: 8 }}>
                    <button className="dbtn dbtn-s" onClick={() => setEditing(true)}>✏️ تعديل القضية</button>
                    <button className="dbtn dbtn-d" onClick={del} disabled={editBusy}>🗑️ حذف القضية</button>
                  </div>
                  {editErr && <div style={{ color: '#F87171', fontSize: '.8rem', marginTop: 8 }}>⚠ {editErr}</div>}
                </>
              ) : (
                <>
                  <div className="fg">
                    <Field label="رقم القضية"><input className="fi" value={editForm.number} onChange={ef('number')} /></Field>
                    <Field label="العنوان"><input className="fi" value={editForm.title} onChange={ef('title')} /></Field>
                    <Field label="النوع"><input className="fi" value={editForm.type} onChange={ef('type')} /></Field>
                    <Field label="المحكمة"><input className="fi" value={editForm.court} onChange={ef('court')} /></Field>
                    <Field label="الحالة">
                      <select className="fi" value={editForm.status} onChange={ef('status')}>
                        <option value="ACTIVE">نشطة</option>
                        <option value="SUSPENDED">معلقة</option>
                        <option value="CLOSED">مغلقة</option>
                        <option value="PENDING">قيد الانتظار</option>
                      </select>
                    </Field>
                    {isAdmin && (
                      <Field label="المحامي المسؤول">
                        <select className="fi" value={editForm.lawyerId} onChange={ef('lawyerId')}>
                          <option value="">— بدون تعيين (يبقى معك) —</option>
                          {lawyers.filter((u: any) => u.role === 'LAWYER').map((u: any) => <option key={u.id} value={u.id}>{u.name}</option>)}
                        </select>
                      </Field>
                    )}
                    <Field label="ملاحظات" full><textarea className="fi" value={editForm.notes} onChange={ef('notes')} /></Field>
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
          {tab === 'sessions' && (
            <div className="tp active">
              {c.sessions?.length === 0 ? <div style={{ color: '#64748B', textAlign: 'center', padding: 20 }}>لا توجد جلسات</div>
                : <div className="tl">{c.sessions?.map((s: any) => (
                  <TimelineItem key={s.id} date={fmtDate(s.date)} text={`${s.court} · ${s.time}${s.judge ? ` · ${s.judge}` : ''}`} color={s.status === 'UPCOMING' ? '#F59E0B' : s.status === 'DONE' ? '#10B981' : '#64748B'} />
                ))}</div>
              }
            </div>
          )}
          {tab === 'files' && (
            <div className="tp active">
              {c.documents?.length === 0 ? <div style={{ color: '#64748B', textAlign: 'center', padding: 20 }}>لا توجد ملفات</div>
                : c.documents?.map((d: any) => <InfoLine key={d.id} text={`📄 ${d.name}`} />)
              }
            </div>
          )}
        </>
      )}
    </div>
  )
}
