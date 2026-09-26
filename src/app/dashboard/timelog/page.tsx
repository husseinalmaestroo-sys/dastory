'use client'

import { useEffect, useState } from 'react'
import { Badge, ErrorState, Field, LoadMore, SectionHeader, StatCard } from '@/components/dashboard/ui'
import type { TimeEntry } from '@/lib/dashboard/types'
import { fmtMinutes } from '@/lib/dashboard/format'
import { usePaginatedList } from '@/components/dashboard/usePaginatedList'
import { apiFetch, errorMessage, fetchAllPages } from '@/lib/dashboard/api-client'

type Summary = { totalMinutes: number; billableMinutes: number; invoicedMinutes: number }

export default function TimeLogPage() {
  const [showForm, setShowForm] = useState(false)
  const [running, setRunning] = useState(false)
  const [seconds, setSeconds] = useState(0)
  const [task, setTask] = useState('')
  const [caseId, setCaseId] = useState('')
  const [duration, setDuration] = useState('')
  const [billable, setBillable] = useState(true)
  const [activeTask, setActiveTask] = useState('لا توجد مهمة نشطة')
  const [cases, setCases] = useState<{ id: string; number: string; title: string }[]>([])
  const [casesError, setCasesError] = useState('')
  const [err, setErr] = useState('')
  const [reloadKey, setReloadKey] = useState(0)
  const list = usePaginatedList<TimeEntry>('/api/time-entries', reloadKey)
  const entries = list.items
  const [summary, setSummary] = useState<Summary | null>(null)
  const [summaryError, setSummaryError] = useState('')
  const load = () => setReloadKey((k) => k + 1)

  useEffect(() => {
    let cancelled = false
    apiFetch<Summary>('/api/time-entries/summary')
      .then(({ data }) => { if (!cancelled) { setSummary(data); setSummaryError('') } })
      .catch((e) => { if (!cancelled) setSummaryError(errorMessage(e)) })
    return () => { cancelled = true }
  }, [reloadKey])

  // The case picker must offer every case, not only the first page.
  useEffect(() => {
    let cancelled = false
    fetchAllPages<any>('/api/cases')
      .then(({ items }) => { if (!cancelled) setCases(items) })
      .catch((e) => { if (!cancelled) setCasesError(errorMessage(e)) })
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    if (!running) return
    const timer = window.setInterval(() => setSeconds((value) => value + 1), 1000)
    return () => window.clearInterval(timer)
  }, [running])

  const display = [Math.floor(seconds / 3600), Math.floor((seconds % 3600) / 60), seconds % 60]
    .map((part) => String(part).padStart(2, '0'))
    .join(':')

  const start = () => {
    setActiveTask(task || 'مهمة جديدة')
    setRunning(true)
  }

  async function saveEntry(minutes: number, taskLabel: string): Promise<boolean> {
    if (minutes <= 0) return false
    try {
      await apiFetch('/api/time-entries', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ task: taskLabel, minutes, caseId: caseId || null, billable }),
      })
      load()
      return true
    } catch (e) { setErr(`تعذّر حفظ الوقت: ${errorMessage(e)}`); return false }
  }

  const stop = async () => {
    const minutes = Math.round(seconds / 60)
    await saveEntry(minutes, activeTask)
    setRunning(false)
    setSeconds(0)
    setActiveTask('لا توجد مهمة نشطة')
  }

  const addManual = async () => {
    setErr('')
    const [h, m] = duration.split(':').map((v) => Number(v) || 0)
    const minutes = h * 60 + m
    if (!task.trim() || minutes <= 0) { setErr('يرجى تعبئة المهمة والمدة (بصيغة ساعة:دقيقة)'); return }
    if (!(await saveEntry(minutes, task.trim()))) return
    setShowForm(false)
    setTask(''); setDuration('')
  }

  async function markInvoiced(id: string) {
    setErr('')
    try {
      await apiFetch(`/api/time-entries/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ invoiced: true }) })
      load()
    } catch (e) { setErr(`تعذّر تحديث الإدخال: ${errorMessage(e)}`) }
  }

  const totalMinutes = summary?.totalMinutes ?? 0
  const billableMinutes = summary?.billableMinutes ?? 0
  const invoicedMinutes = summary?.invoicedMinutes ?? 0
  const conversion = billableMinutes > 0 ? Math.round((invoicedMinutes / billableMinutes) * 100) : 0

  return (
    <div className="pg">
      <SectionHeader title="⏱️ تتبع الوقت" subtitle={list.loading ? 'جاري التحميل...' : 'سجل الوقت الفعلي'}>
        <button className="dbtn dbtn-p" onClick={() => setShowForm(true)}>+ تسجيل وقت</button>
      </SectionHeader>

      {summaryError && <ErrorState message={summaryError} />}
      {err && !showForm && <ErrorState message={err} />}
      <div className="sg">
        <StatCard icon="⏱️" value={fmtMinutes(totalMinutes)} label="إجمالي الساعات" />
        <StatCard icon="💵" value={fmtMinutes(billableMinutes)} label="قابلة للفوترة" />
        <StatCard icon="✅" value={fmtMinutes(invoicedMinutes)} label="مُفوترة" />
        <StatCard icon="📈" value={`${conversion}%`} label="نسبة التحويل" />
      </div>

      <div className="card" style={{ marginBottom: 20, background: 'linear-gradient(135deg,rgba(212,175,55,.08),rgba(30,58,138,.1))', border: '1px solid rgba(212,175,55,.2)' }}>
        <div className="ct">⏰ المؤقّت النشط</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 20, flexWrap: 'wrap' }}>
          <div style={{ fontSize: '2.2rem', fontWeight: 900, fontVariantNumeric: 'tabular-nums', color: '#D4AF37', letterSpacing: 2 }}>{display}</div>
          <div style={{ flex: 1, minWidth: 180 }}>
            <div style={{ fontSize: '.85rem', fontWeight: 700, color: '#E2E8F0' }}>{activeTask}</div>
            {!running && <input className="fi" style={{ marginTop: 4 }} value={task} onChange={(e) => setTask(e.target.value)} placeholder="وصف المهمة قبل البدء" />}
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            {!running ? (
              <button className="dbtn dbtn-p" onClick={start} style={{ minWidth: 90 }}>▶ ابدأ</button>
            ) : (
              <button className="dbtn" onClick={stop} style={{ minWidth: 90, background: '#EF4444', color: '#fff' }}>■ إيقاف وحفظ</button>
            )}
          </div>
        </div>
      </div>

      {showForm && (
        <div className="card" style={{ marginBottom: 20, border: '1px solid rgba(212,175,55,.25)' }}>
          <div className="ct">📝 تسجيل وقت يدوي</div>
          <div className="fg">
            <Field label="القضية (اختياري)">
              <select className="inp" value={caseId} onChange={(e) => setCaseId(e.target.value)}>
                <option value="">— بدون قضية —</option>
                {cases.map(c => <option key={c.id} value={c.id}>{c.number} — {c.title}</option>)}
              </select>
              {casesError && <div style={{ color: '#F87171', fontSize: '.75rem', marginTop: 4 }}>⚠️ تعذّر تحميل قائمة القضايا: {casesError}</div>}
            </Field>
            <Field label="وصف المهمة"><input className="inp" value={task} onChange={(e) => setTask(e.target.value)} placeholder="مثال: مراجعة العقد الابتدائي" /></Field>
            <Field label="المدة (ساعة:دقيقة)"><input className="inp" value={duration} onChange={(e) => setDuration(e.target.value)} placeholder="1:30" /></Field>
            <Field label="النوع">
              <select className="inp" value={billable ? '1' : '0'} onChange={(e) => setBillable(e.target.value === '1')}>
                <option value="1">قابل للفوترة</option>
                <option value="0">داخلي / غير قابل للفوترة</option>
              </select>
            </Field>
            {err && <div style={{ color: '#F87171', fontSize: '.8rem' }}>⚠ {err}</div>}
            <div style={{ display: 'flex', alignItems: 'end', gap: 8 }}>
              <button className="dbtn dbtn-p" onClick={addManual} style={{ flex: 1 }}>✓ حفظ</button>
              <button className="dbtn dbtn-s" onClick={() => setShowForm(false)} style={{ flex: 1 }}>إلغاء</button>
            </div>
          </div>
        </div>
      )}

      <div className="card">
        <div className="ct">📋 سجل الوقت</div>
        <table className="tbl">
          <tbody>
            <tr><th>التاريخ</th><th>المهمة</th><th>القضية</th><th>المدة</th><th>النوع</th><th>الحالة</th><th /></tr>
            {list.loading ? (
              <tr><td colSpan={7} style={{ textAlign: 'center', color: '#64748B', padding: 20 }}>جارٍ التحميل...</td></tr>
            ) : list.error && entries.length === 0 ? (
              <tr><td colSpan={7}><ErrorState message={list.error} onRetry={list.retry} /></td></tr>
            ) : entries.length === 0 ? (
              <tr><td colSpan={7} style={{ textAlign: 'center', color: '#64748B', padding: 20 }}>لا توجد إدخالات وقت بعد</td></tr>
            ) : entries.map((entry) => (
              <tr key={entry.id}>
                <td>{new Date(entry.date).toLocaleDateString('ar-JO')}</td>
                <td>{entry.task}</td>
                <td>{entry.case ? entry.case.number : '—'}</td>
                <td>{fmtMinutes(entry.minutes)}</td>
                <td><Badge type={entry.billable ? 'bl' : 'cl'}>{entry.billable ? 'قابل للفوترة' : 'داخلي'}</Badge></td>
                <td><Badge type={entry.invoiced ? 'ac' : 'pe'}>{entry.invoiced ? 'مُفوتر' : 'معلّق'}</Badge></td>
                <td>{entry.billable && !entry.invoiced && <button className="dbtn dbtn-s" style={{ fontSize: '.72rem', padding: '3px 9px' }} onClick={() => markInvoiced(entry.id)}>فوتِر</button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {list.error && entries.length > 0 && <ErrorState message={list.error} onRetry={list.loadMore} />}
        <LoadMore shown={entries.length} total={list.total} hasMore={list.hasMore} loading={list.loadingMore} onClick={list.loadMore} />
      </div>
    </div>
  )
}
