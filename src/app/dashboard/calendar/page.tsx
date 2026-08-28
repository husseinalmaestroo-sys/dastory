'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { CalendarItem, Field, SectionHeader } from '@/components/dashboard/ui'

const monthNames = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر']

type CalSession = { id: string; date: string; time: string; court: string; status: string; case: { number: string; title: string } }
type CalEvent = { id: string; title: string; date: string; type: string }
type DayMark = { label: string; color: string; sortKey: string }

export default function CalendarPage() {
  const [now] = useState(() => new Date())
  const [month, setMonth] = useState(now.getMonth())
  const [year, setYear] = useState(now.getFullYear())
  const [sessions, setSessions] = useState<CalSession[]>([])
  const [calEvents, setCalEvents] = useState<CalEvent[]>([])
  const [showForm, setShowForm] = useState(false)
  const [newTitle, setNewTitle] = useState('')
  const [newDate, setNewDate] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(() => {
    fetch('/api/sessions').then(r => r.json()).then(d => { if (Array.isArray(d)) setSessions(d) }).catch(() => {})
    fetch('/api/calendar-events').then(r => r.json()).then(d => { if (Array.isArray(d)) setCalEvents(d) }).catch(() => {})
  }, [])
  useEffect(() => { load() }, [load])

  const dayKey = (d: Date | string) => { const dt = new Date(d); return `${dt.getFullYear()}-${dt.getMonth()}-${dt.getDate()}` }

  const eventsByDay = useMemo(() => {
    const map: Record<string, DayMark[]> = {}
    for (const s of sessions) {
      const k = dayKey(s.date)
      const color = s.status === 'DONE' ? '#10B981' : s.status === 'POSTPONED' ? '#F59E0B' : '#EF4444'
      const label = `${s.status === 'POSTPONED' ? '🟡' : s.status === 'DONE' ? '🟢' : '🔴'} جلسة ${s.case.number} ${s.time}`
      ;(map[k] ??= []).push({ label, color, sortKey: s.time })
    }
    for (const e of calEvents) {
      const k = dayKey(e.date)
      ;(map[k] ??= []).push({ label: `🟢 ${e.title}`, color: '#60A5FA', sortKey: '00:00' })
    }
    return map
  }, [sessions, calEvents])

  const cells = useMemo(() => {
    const first = new Date(year, month, 1).getDay()
    const days = new Date(year, month + 1, 0).getDate()
    return [...Array.from({ length: first }, () => null), ...Array.from({ length: days }, (_, index) => index + 1)]
  }, [month, year])

  const nav = (dir: number) => {
    setMonth((current) => {
      const next = current + dir
      if (next > 11) { setYear((value) => value + 1); return 0 }
      if (next < 0) { setYear((value) => value - 1); return 11 }
      return next
    })
  }

  async function addEvent() {
    if (!newTitle.trim() || !newDate) return
    setBusy(true)
    try {
      const res = await fetch('/api/calendar-events', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: newTitle.trim(), date: newDate }),
      })
      if (res.ok) { setNewTitle(''); setNewDate(''); setShowForm(false); load() }
    } finally { setBusy(false) }
  }

  const todayKey = dayKey(now)
  const todayMarks = eventsByDay[todayKey] ?? []

  const weekAhead = useMemo(() => {
    const items: { date: Date; label: string; color: string }[] = []
    for (let i = 1; i <= 7; i++) {
      const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + i)
      const marks = eventsByDay[dayKey(d)] ?? []
      for (const m of marks) items.push({ date: d, label: m.label, color: m.color })
    }
    return items.slice(0, 8)
  }, [eventsByDay, now])

  return (
    <div className="pg">
      <SectionHeader title="🗓️ التقويم الشامل" subtitle={`${monthNames[month]} ${year}`}>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="dbtn dbtn-s" onClick={() => nav(-1)}>‹ السابق</button>
          <button className="dbtn dbtn-s" onClick={() => nav(1)}>التالي ›</button>
          <button className="dbtn dbtn-p" onClick={() => setShowForm(v => !v)}>+ حدث جديد</button>
        </div>
      </SectionHeader>
      {showForm && (
        <div className="card" style={{ marginBottom: 14, border: '1px solid rgba(212,175,55,.25)' }}>
          <div className="fg">
            <Field label="عنوان الحدث"><input className="fi" value={newTitle} onChange={e => setNewTitle(e.target.value)} placeholder="مثال: تجديد اشتراك النقابة" /></Field>
            <Field label="التاريخ"><input className="fi" type="date" value={newDate} onChange={e => setNewDate(e.target.value)} /></Field>
          </div>
          <div style={{ marginTop: 10, display: 'flex', gap: 8 }}>
            <button className="dbtn dbtn-p" onClick={addEvent} disabled={busy || !newTitle.trim() || !newDate}>{busy ? 'جارٍ الحفظ...' : '✅ حفظ'}</button>
            <button className="dbtn dbtn-s" onClick={() => setShowForm(false)}>إلغاء</button>
          </div>
        </div>
      )}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 280px', gap: 16 }}>
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7,1fr)', background: 'rgba(30,58,138,.3)', borderBottom: '1px solid rgba(255,255,255,.06)' }}>
            {['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'].map((day, index) => (
              <div key={day} style={{ padding: '10px 0', textAlign: 'center', fontSize: '.78rem', fontWeight: 700, color: index === 5 ? '#D4AF37' : index === 6 ? '#EF4444' : '#64748B' }}>{day}</div>
            ))}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7,1fr)', minHeight: 420 }}>
            {cells.map((day, index) => {
              const key = day ? `${year}-${month}-${day}` : ''
              const dayEvents = key ? (eventsByDay[key] ?? []).sort((a, b) => a.sortKey.localeCompare(b.sortKey)) : []
              const today = key === todayKey
              return (
                <div key={`${day}-${index}`} style={{ border: '1px solid rgba(255,255,255,.05)', minHeight: 80, padding: 6, background: today ? 'rgba(212,175,55,.1)' : day ? 'transparent' : 'rgba(0,0,0,.1)', borderColor: today ? 'rgba(212,175,55,.3)' : 'rgba(255,255,255,.05)' }}>
                  {day && <span style={{ color: today ? '#D4AF37' : '#94A3B8', fontSize: '.8rem', fontWeight: 700 }}>{day}</span>}
                  {dayEvents.map((event, i) => (
                    <div key={i} style={{ fontSize: '.65rem', marginTop: 2, padding: '2px 4px', borderRadius: 4, background: 'rgba(255,255,255,.07)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', color: '#CBD5E1' }}>{event.label}</div>
                  ))}
                </div>
              )
            })}
          </div>
        </div>
        <div>
          <div className="card" style={{ marginBottom: 14 }}>
            <div className="ct">📌 أحداث اليوم</div>
            {todayMarks.length === 0
              ? <div style={{ color: '#64748B', fontSize: '.8rem', padding: 8 }}>لا توجد أحداث اليوم</div>
              : todayMarks.map((m, i) => <CalendarItem key={i} color={m.color} title={m.label} subtitle="" />)}
          </div>
          <div className="card">
            <div className="ct">📅 قادم خلال 7 أيام</div>
            {weekAhead.length === 0
              ? <div style={{ color: '#64748B', fontSize: '.8rem', padding: 8 }}>لا توجد أحداث قادمة</div>
              : weekAhead.map((m, i) => <CalendarItem key={i} color={m.color} title={m.label} subtitle={m.date.toLocaleDateString('ar-JO', { weekday: 'long', day: 'numeric', month: 'numeric' })} />)}
          </div>
        </div>
      </div>
    </div>
  )
}
