'use client'

import { useState, useEffect } from 'react'
import { Scale, FileText, Calendar, CreditCard, LogOut, Clock, AlertCircle } from 'lucide-react'

// ─── Types ───────────────────────────────────────────────────────────────────
interface CitizenUser {
  id: string
  name: string
  email: string
  role: string
}

interface CitizenCase {
  id: string
  number: string
  title: string
  type: string
  court: string | null
  status: 'ACTIVE' | 'CLOSED' | 'SUSPENDED' | 'PENDING'
  lawyer: { name: string } | null
  sessions: { id: string; date: string; time: string; court: string; status: string }[]
  _count: { sessions: number; documents: number }
  createdAt: string
}

interface CitizenSession {
  id: string
  date: string
  time: string
  court: string
  status: 'UPCOMING' | 'DONE' | 'POSTPONED'
  notes: string | null
  case: { number: string; title: string }
}

interface CitizenInvoice {
  id: string
  number: string
  amount: number
  paid: number
  status: 'PAID' | 'UNPAID' | 'PARTIAL' | 'OVERDUE'
  dueDate: string | null
  case: { number: string; title: string } | null
}

// ─── Helpers ─────────────────────────────────────────────────────────────────
function fmtDate(d: string | null) {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('ar-JO', { year: 'numeric', month: 'long', day: 'numeric' })
}

function fmtMoney(n: number) {
  return n.toLocaleString('ar-JO', { minimumFractionDigits: 0 }) + ' د.أ'
}

const caseStatusLabel: Record<string, string> = { ACTIVE: 'نشطة', CLOSED: 'مغلقة', SUSPENDED: 'موقوفة', PENDING: 'معلقة' }
const caseStatusColor: Record<string, string> = {
  ACTIVE: 'bg-emerald-100 text-emerald-700',
  CLOSED: 'bg-slate-100 text-slate-600',
  SUSPENDED: 'bg-amber-100 text-amber-700',
  PENDING: 'bg-blue-100 text-blue-700',
}
const sesStatusLabel: Record<string, string> = { UPCOMING: 'قادمة', DONE: 'منتهية', POSTPONED: 'مؤجلة' }
const sesStatusColor: Record<string, string> = {
  UPCOMING: 'bg-blue-100 text-blue-700',
  DONE: 'bg-slate-100 text-slate-600',
  POSTPONED: 'bg-amber-100 text-amber-700',
}
const invStatusLabel: Record<string, string> = { PAID: 'مدفوعة', UNPAID: 'غير مدفوعة', PARTIAL: 'جزئية', OVERDUE: 'متأخرة' }
const invStatusColor: Record<string, string> = {
  PAID: 'bg-emerald-100 text-emerald-700',
  UNPAID: 'bg-slate-100 text-slate-600',
  PARTIAL: 'bg-blue-100 text-blue-700',
  OVERDUE: 'bg-red-100 text-red-700',
}

// ─── Login Screen ─────────────────────────────────────────────────────────────
function LoginScreen({ onLogin }: { onLogin: (user: CitizenUser, token: string) => void }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error || 'فشل تسجيل الدخول'); return }
      if (data.user.role !== 'CITIZEN') { setError('هذه البوابة مخصصة للمواطنين فقط'); return }
      onLogin(data.user, data.token)
    } catch {
      setError('تعذّر الاتصال بالخادم')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="w-16 h-16 bg-amber-500 rounded-2xl flex items-center justify-center mx-auto mb-4">
            <Scale className="w-8 h-8 text-white" />
          </div>
          <h1 className="text-2xl font-bold text-white">بوابة المواطن</h1>
          <p className="text-slate-400 text-sm mt-1">تابع قضاياك وجلساتك وفواتيرك</p>
        </div>

        <div className="bg-white/5 border border-white/10 rounded-2xl p-8 backdrop-blur">
          <form onSubmit={handleSubmit} className="space-y-4" dir="rtl">
            <div>
              <label className="block text-sm text-slate-300 mb-1.5">البريد الإلكتروني</label>
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-2.5 text-white placeholder-slate-500 focus:outline-none focus:border-amber-500 transition"
                placeholder="name@example.com"
                required
              />
            </div>
            <div>
              <label className="block text-sm text-slate-300 mb-1.5">كلمة المرور</label>
              <input
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-2.5 text-white placeholder-slate-500 focus:outline-none focus:border-amber-500 transition"
                placeholder="••••••••"
                required
              />
            </div>
            {error && (
              <div className="flex items-center gap-2 bg-red-500/10 border border-red-500/20 text-red-400 text-sm rounded-lg px-4 py-2.5">
                <AlertCircle className="w-4 h-4 shrink-0" />
                {error}
              </div>
            )}
            <button
              type="submit"
              disabled={loading}
              className="w-full bg-amber-500 hover:bg-amber-600 text-white font-medium py-2.5 rounded-lg transition disabled:opacity-50"
            >
              {loading ? 'جارٍ الدخول...' : 'تسجيل الدخول'}
            </button>
          </form>
        </div>
      </div>
    </div>
  )
}

// ─── Portal ──────────────────────────────────────────────────────────────────
type Tab = 'cases' | 'sessions' | 'invoices'

function CitizenPortal({ user, onLogout }: { user: CitizenUser; onLogout: () => void }) {
  const [tab, setTab] = useState<Tab>('cases')
  const [cases, setCases] = useState<CitizenCase[]>([])
  const [sessions, setSessions] = useState<CitizenSession[]>([])
  const [invoices, setInvoices] = useState<CitizenInvoice[]>([])
  const [error, setError] = useState('')
  // loading is derived: true whenever the tab whose data we last settled
  // isn't the selected one. Avoids a synchronous setLoading(true) inside the
  // tab effect (react-hooks/set-state-in-effect).
  const [loadedTab, setLoadedTab] = useState<Tab | null>(null)
  const loading = loadedTab !== tab

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const res = await fetch(`/api/citizen/${tab}`)
        if (!res.ok) throw new Error('فشل تحميل البيانات')
        const data = await res.json()
        if (cancelled) return
        if (tab === 'cases') setCases(data)
        else if (tab === 'sessions') setSessions(data)
        else setInvoices(data)
        setError('')
      } catch {
        if (!cancelled) setError('تعذّر تحميل البيانات')
      } finally {
        if (!cancelled) setLoadedTab(tab)
      }
    })()
    return () => { cancelled = true }
  }, [tab])

  const tabs: { id: Tab; label: string; icon: React.ReactNode }[] = [
    { id: 'cases', label: 'قضاياي', icon: <Scale className="w-4 h-4" /> },
    { id: 'sessions', label: 'الجلسات', icon: <Calendar className="w-4 h-4" /> },
    { id: 'invoices', label: 'الفواتير', icon: <CreditCard className="w-4 h-4" /> },
  ]

  return (
    <div className="min-h-screen bg-slate-50" dir="rtl">
      {/* Header */}
      <header className="bg-white border-b border-slate-200 sticky top-0 z-10">
        <div className="max-w-4xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 bg-amber-500 rounded-xl flex items-center justify-center">
              <Scale className="w-5 h-5 text-white" />
            </div>
            <div>
              <p className="text-xs text-slate-500">مرحباً،</p>
              <p className="font-semibold text-slate-800 text-sm">{user.name}</p>
            </div>
          </div>
          <button
            onClick={onLogout}
            className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-red-500 transition"
          >
            <LogOut className="w-4 h-4" />
            خروج
          </button>
        </div>
      </header>

      {/* Tabs */}
      <div className="bg-white border-b border-slate-200">
        <div className="max-w-4xl mx-auto px-4 flex">
          {tabs.map(t => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`flex items-center gap-2 px-5 py-3 text-sm font-medium border-b-2 transition ${
                tab === t.id
                  ? 'border-amber-500 text-amber-600'
                  : 'border-transparent text-slate-500 hover:text-slate-700'
              }`}
            >
              {t.icon}
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div className="max-w-4xl mx-auto px-4 py-6">
        {loading && (
          <div className="text-center py-16 text-slate-400">
            <div className="w-8 h-8 border-2 border-amber-500 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
            جارٍ التحميل...
          </div>
        )}

        {error && !loading && (
          <div className="text-center py-16 text-red-500">{error}</div>
        )}

        {!loading && !error && tab === 'cases' && (
          <CasesList cases={cases} />
        )}
        {!loading && !error && tab === 'sessions' && (
          <SessionsList sessions={sessions} />
        )}
        {!loading && !error && tab === 'invoices' && (
          <InvoicesList invoices={invoices} />
        )}
      </div>
    </div>
  )
}

// ─── Cases List ──────────────────────────────────────────────────────────────
function CasesList({ cases }: { cases: CitizenCase[] }) {
  if (cases.length === 0) {
    return (
      <div className="text-center py-16 text-slate-400">
        <FileText className="w-10 h-10 mx-auto mb-3 opacity-40" />
        لا توجد قضايا مسجلة
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {cases.map(c => (
        <div key={c.id} className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm">
          <div className="flex items-start justify-between gap-3 mb-3">
            <div>
              <p className="font-semibold text-slate-800">{c.title}</p>
              <p className="text-xs text-slate-500 mt-0.5">رقم القضية: {c.number}</p>
            </div>
            <span className={`text-xs font-medium px-2.5 py-1 rounded-full shrink-0 ${caseStatusColor[c.status]}`}>
              {caseStatusLabel[c.status]}
            </span>
          </div>
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div className="flex items-center gap-1.5 text-slate-600">
              <Scale className="w-3.5 h-3.5 text-slate-400" />
              <span>{c.type}</span>
            </div>
            {c.court && (
              <div className="flex items-center gap-1.5 text-slate-600">
                <FileText className="w-3.5 h-3.5 text-slate-400" />
                <span>{c.court}</span>
              </div>
            )}
            {c.lawyer && (
              <div className="flex items-center gap-1.5 text-slate-600">
                <span className="text-slate-400 text-xs">المحامي:</span>
                <span>{c.lawyer.name}</span>
              </div>
            )}
            <div className="flex items-center gap-3 text-slate-500 text-xs">
              <span>{c._count.sessions} جلسة</span>
              <span>{c._count.documents} مستند</span>
            </div>
          </div>
          {c.sessions.length > 0 && (
            <div className="mt-3 pt-3 border-t border-slate-100">
              <p className="text-xs text-slate-400 mb-1.5">الجلسة القادمة:</p>
              <div className="flex items-center gap-2 text-sm text-slate-600">
                <Calendar className="w-3.5 h-3.5 text-amber-500" />
                <span>{fmtDate(c.sessions[0].date)}</span>
                <Clock className="w-3.5 h-3.5 text-slate-400" />
                <span>{c.sessions[0].time}</span>
                <span className="text-slate-400">—</span>
                <span>{c.sessions[0].court}</span>
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

// ─── Sessions List ────────────────────────────────────────────────────────────
function SessionsList({ sessions }: { sessions: CitizenSession[] }) {
  if (sessions.length === 0) {
    return (
      <div className="text-center py-16 text-slate-400">
        <Calendar className="w-10 h-10 mx-auto mb-3 opacity-40" />
        لا توجد جلسات
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {sessions.map(s => (
        <div key={s.id} className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="font-medium text-slate-700">{s.case.title}</p>
              <p className="text-xs text-slate-400 mt-0.5">القضية رقم {s.case.number}</p>
            </div>
            <span className={`text-xs font-medium px-2.5 py-1 rounded-full shrink-0 ${sesStatusColor[s.status]}`}>
              {sesStatusLabel[s.status]}
            </span>
          </div>
          <div className="mt-3 flex flex-wrap gap-4 text-sm text-slate-600">
            <div className="flex items-center gap-1.5">
              <Calendar className="w-3.5 h-3.5 text-amber-500" />
              {fmtDate(s.date)}
            </div>
            <div className="flex items-center gap-1.5">
              <Clock className="w-3.5 h-3.5 text-slate-400" />
              {s.time}
            </div>
            <div className="flex items-center gap-1.5">
              <Scale className="w-3.5 h-3.5 text-slate-400" />
              {s.court}
            </div>
          </div>
          {/* Session notes are internal staff data — never sent to the client portal (src/lib/citizen-fields.ts). */}
        </div>
      ))}
    </div>
  )
}

// ─── Invoices List ────────────────────────────────────────────────────────────
function InvoicesList({ invoices }: { invoices: CitizenInvoice[] }) {
  if (invoices.length === 0) {
    return (
      <div className="text-center py-16 text-slate-400">
        <CreditCard className="w-10 h-10 mx-auto mb-3 opacity-40" />
        لا توجد فواتير
      </div>
    )
  }

  const total = invoices.reduce((s, i) => s + i.amount, 0)
  const paid = invoices.reduce((s, i) => s + i.paid, 0)
  const remaining = total - paid

  return (
    <div className="space-y-4">
      {/* Summary bar */}
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: 'إجمالي الفواتير', val: fmtMoney(total), color: 'text-slate-700' },
          { label: 'المدفوع', val: fmtMoney(paid), color: 'text-emerald-600' },
          { label: 'المتبقي', val: fmtMoney(remaining), color: remaining > 0 ? 'text-red-500' : 'text-emerald-600' },
        ].map(item => (
          <div key={item.label} className="bg-white rounded-xl border border-slate-200 p-4 text-center shadow-sm">
            <p className="text-xs text-slate-500">{item.label}</p>
            <p className={`font-bold text-lg mt-1 ${item.color}`}>{item.val}</p>
          </div>
        ))}
      </div>

      {invoices.map(inv => (
        <div key={inv.id} className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm">
          <div className="flex items-start justify-between gap-3 mb-3">
            <div>
              <p className="font-semibold text-slate-800">{inv.number}</p>
              {inv.case && <p className="text-xs text-slate-500 mt-0.5">{inv.case.title}</p>}
            </div>
            <span className={`text-xs font-medium px-2.5 py-1 rounded-full shrink-0 ${invStatusColor[inv.status]}`}>
              {invStatusLabel[inv.status]}
            </span>
          </div>
          <div className="grid grid-cols-3 gap-3 text-sm">
            <div>
              <p className="text-xs text-slate-400">المبلغ الكلي</p>
              <p className="font-semibold text-slate-700 mt-0.5">{fmtMoney(inv.amount)}</p>
            </div>
            <div>
              <p className="text-xs text-slate-400">المدفوع</p>
              <p className="font-semibold text-emerald-600 mt-0.5">{fmtMoney(inv.paid)}</p>
            </div>
            <div>
              <p className="text-xs text-slate-400">المتبقي</p>
              <p className={`font-semibold mt-0.5 ${inv.amount - inv.paid > 0 ? 'text-red-500' : 'text-slate-400'}`}>
                {fmtMoney(inv.amount - inv.paid)}
              </p>
            </div>
          </div>
          {inv.dueDate && (
            <p className="mt-2 text-xs text-slate-500">
              تاريخ الاستحقاق: {fmtDate(inv.dueDate)}
            </p>
          )}
        </div>
      ))}
    </div>
  )
}

// ─── Root Page ────────────────────────────────────────────────────────────────
export default function CitizenPage() {
  const [user, setUser] = useState<CitizenUser | null>(null)

  function handleLogin(u: CitizenUser) {
    setUser(u)
  }

  function handleLogout() {
    fetch('/api/auth/logout', { method: 'POST' }).finally(() => setUser(null))
  }

  if (!user) return <LoginScreen onLogin={handleLogin} />
  return <CitizenPortal user={user} onLogout={handleLogout} />
}
