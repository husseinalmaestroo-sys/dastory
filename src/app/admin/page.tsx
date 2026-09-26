'use client'

import { useState, useEffect, useCallback } from 'react'

/* ─── Types ──────────────────────────────── */
type Page = 'overview' | 'ticker' | 'homepage' | 'subs' | 'trials' | 'settings'
type VTab = 'yt' | 'mp4'
type TrialRequest = {
  id: string
  createdAt: string
  officeName: string
  lawyerName: string
  officePhone: string
  mobile: string
  city: string
  email: string
  status: string
}
type SubStatus = 'NONE' | 'TRIALING' | 'ACTIVE' | 'PAST_DUE' | 'CANCELED'
type Subscriber = {
  officeId: string
  officeName: string
  officeActive: boolean
  managerName: string | null
  managerEmail: string | null
  plan: string | null
  status: SubStatus
  renewsAt: string | null
  createdAt: string
}
type AdminStats = {
  subscribedOffices: number
  activeOffices: number
  trialingOffices: number
  pastDueOffices: number
  canceledOffices: number
  totalOffices: number
  newTrialRequests: number
}

const SUB_STATUS_BADGE: Record<SubStatus, { type: 'g' | 'r' | 'y' | 'b'; label: string }> = {
  ACTIVE:   { type: 'g', label: '● نشط' },
  TRIALING: { type: 'y', label: '● تجربة' },
  PAST_DUE: { type: 'r', label: '● متأخر' },
  CANCELED: { type: 'r', label: '● ملغى' },
  NONE:     { type: 'b', label: '— بلا اشتراك' },
}

function fmtDate(iso: string | null) {
  if (!iso) return '—'
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString('en-GB')
}

const DEFAULT_TICKER = [
  '✦ للتواصل مع دُسْتُورِي عبر واتساب: +962 79 000 0000',
  '✦ احجز الآن واكتشف نظام إدارة القضايا والتشريعات من مكان واحد',
  '✦ عروض إطلاق خاصة لمكاتب المحاماة الأردنية — 3 أشهر مجاناً',
  '✦ منصة دُسْتُورِي — منظومة المحامي الذكي',
]

/* ─── Helpers ────────────────────────────── */
function ytToEmbed(url: string) {
  const m = url.match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|embed\/|shorts\/))([A-Za-z0-9_-]{11})/)
  return m ? `https://www.youtube.com/embed/${m[1]}` : ''
}

// Module scope, not defined inside AdminPage: a component created during
// render is a new type every render, which breaks reconciliation and trips
// react-hooks/static-components. It only uses its own props, so hoisting is
// a pure move.
function Bx({ type, label }: { type: 'g' | 'r' | 'y' | 'b'; label: string }) {
  const map = { g: { c: '#10B981', bg: 'rgba(16,185,129,.07)', bc: 'rgba(16,185,129,.3)' }, r: { c: '#EF4444', bg: 'rgba(239,68,68,.07)', bc: 'rgba(239,68,68,.3)' }, y: { c: '#F59E0B', bg: 'rgba(245,158,11,.07)', bc: 'rgba(245,158,11,.3)' }, b: { c: '#60A5FA', bg: 'rgba(96,165,250,.07)', bc: 'rgba(96,165,250,.3)' } }
  const s = map[type]
  return <span style={{ display: 'inline-block', fontSize: '.71rem', fontWeight: 700, padding: '2px 8px', borderRadius: 20, border: `1px solid ${s.bc}`, background: s.bg, color: s.c }}>{label}</span>
}

function Toast({ msg, onDone }: { msg: string; onDone: () => void }) {
  useEffect(() => { const t = setTimeout(onDone, 3000); return () => clearTimeout(t) }, [onDone])
  return (
    <div style={{ position: 'fixed', bottom: 28, left: '50%', transform: 'translateX(-50%)', background: '#10B981', color: '#fff', fontFamily: 'Cairo,sans-serif', fontSize: '.85rem', fontWeight: 700, padding: '11px 22px', borderRadius: 12, zIndex: 9999, boxShadow: '0 8px 24px rgba(0,0,0,.3)' }}>
      {msg}
    </div>
  )
}

export default function AdminPage() {
  const [loggedIn, setLoggedIn]     = useState(false)
  const [email, setEmail]           = useState('')
  const [password, setPassword]     = useState('')
  const [loginBusy, setLoginBusy]   = useState(false)
  const [loginError, setLoginError] = useState('')
  // Platform admin requires 2FA: the password step issues a short-lived
  // pending session, completed by the TOTP code step below.
  const [needs2fa, setNeeds2fa]     = useState(false)
  const [totpCode, setTotpCode]     = useState('')
  const [authEmail, setAuthEmail]   = useState('')
  const [page, setPage]             = useState<Page>('overview')
  const [tickerItems, setTickerItems] = useState<string[]>(DEFAULT_TICKER)
  const [newTickerText, setNewTickerText] = useState('')
  const [tickerBg, setTickerBg]     = useState('#0F172A')
  const [tickerColor, setTickerColor] = useState('#D4AF37')
  const [tickerSpeed, setTickerSpeed] = useState(40)
  const [vtab, setVtab]             = useState<VTab>('yt')
  const [ytUrl, setYtUrl]           = useState('')
  const [mp4Url, setMp4Url]         = useState('')
  const [autoplay, setAutoplay]     = useState(true)
  const [loop, setLoop]             = useState(true)
  const [controls, setControls]     = useState(false)
  const [toast, setToast]           = useState('')
  const [ctPhone, setCtPhone]       = useState('+962 79 000 0000')
  const [ctWa, setCtWa]             = useState('9627900000001')
  const [ctEmail, setCtEmail]       = useState('info@dostoori.jo')
  const [trialRequests, setTrialRequests] = useState<TrialRequest[]>([])
  const [subscribers, setSubscribers] = useState<Subscriber[]>([])
  const [stats, setStats] = useState<AdminStats | null>(null)
  const [subSearch, setSubSearch] = useState('')
  const [subStatusFilter, setSubStatusFilter] = useState<'ALL' | SubStatus>('ALL')
  const [actionBusy, setActionBusy] = useState<string | null>(null)

  const loadOverview = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/overview')
      if (!res.ok) return
      const data = await res.json()
      if (data.stats) setStats(data.stats)
      if (Array.isArray(data.subscribers)) setSubscribers(data.subscribers)
    } catch {
      // best-effort refresh — the panel just keeps its last-known state
    }
  }, [])

  useEffect(() => {
    fetch('/api/auth/me')
      .then(async (res) => {
        if (!res.ok) return
        const data = await res.json()
        if (data.user?.isPlatformAdmin) {
          setLoggedIn(true)
          setAuthEmail(data.user.email)
        }
      })
      .catch(() => { /* not signed in — the login form is shown */ })
  }, [])

  useEffect(() => {
    if (!loggedIn) return
    fetch('/api/trial-requests')
      .then(async (res) => {
        if (!res.ok) throw new Error((await res.json().catch(() => null))?.error || `HTTP ${res.status}`)
        return res.json()
      })
      .then((data) => { if (Array.isArray(data)) setTrialRequests(data) })
      .catch((err: Error) => setToast(`⚠ تعذّر تحميل طلبات التجربة: ${err.message}`))
    fetch('/api/admin/overview')
      .then(async (res) => {
        if (!res.ok) throw new Error((await res.json().catch(() => null))?.error || `HTTP ${res.status}`)
        return res.json()
      })
      .then((data) => {
        if (data.stats) setStats(data.stats)
        if (Array.isArray(data.subscribers)) setSubscribers(data.subscribers)
      })
      .catch((err: Error) => setToast(`⚠ تعذّر تحميل بيانات المشتركين: ${err.message}`))
  }, [loggedIn])

  async function runOfficeAction(officeId: string, action: 'activate' | 'suspend' | 'extend-trial', successMsg: string) {
    setActionBusy(officeId + action)
    try {
      const res = await fetch(`/api/admin/offices/${officeId}/${action}`, { method: 'POST' })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) { setToast(`⚠ ${data.error || 'تعذر تنفيذ الإجراء'}`); return }
      setToast(successMsg)
      await loadOverview()
    } catch {
      setToast('⚠ تعذر الاتصال بالخادم')
    } finally {
      setActionBusy(null)
    }
  }

  /* Load the real, DB-backed site settings once logged in as platform admin */
  useEffect(() => {
    if (!loggedIn) return
    fetch('/api/site-settings')
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        return res.json()
      })
      .then((s) => {
        setTickerItems(s.tickerItems)
        setTickerBg(s.tickerBg)
        setTickerColor(s.tickerColor)
        setTickerSpeed(s.tickerSpeed)
        if (s.heroVideo) {
          setVtab(s.heroVideo.type)
          if (s.heroVideo.type === 'mp4') setMp4Url(s.heroVideo.url); else setYtUrl(s.heroVideo.url)
          setAutoplay(s.heroVideo.autoplay)
          setLoop(s.heroVideo.loop)
          setControls(s.heroVideo.controls)
        }
        setCtPhone(s.contactPhone)
        setCtWa(s.contactWhatsapp)
        setCtEmail(s.contactEmail)
      })
      .catch((err: Error) => setToast(`⚠ تعذّر تحميل إعدادات الموقع: ${err.message}`))
  }, [loggedIn])

  async function patchSiteSettings(body: Record<string, unknown>, successMsg: string) {
    try {
      const res = await fetch('/api/site-settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json()
      if (!res.ok) { setToast(`⚠ ${data.error || 'تعذر الحفظ'}`); return }
      setToast(successMsg)
    } catch {
      setToast('⚠ تعذر الاتصال بالخادم')
    }
  }

  const saveContact = () => {
    patchSiteSettings(
      { contactPhone: ctPhone, contactWhatsapp: ctWa, contactEmail: ctEmail },
      '✓ تم حفظ بيانات التواصل وتطبيقها على الموقع'
    )
  }

  const login = async () => {
    if (!email || !password) {
      setLoginError('يرجى إدخال البريد وكلمة المرور')
      return
    }

    setLoginBusy(true)
    setLoginError('')
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      })
      const data = await res.json()
      if (!res.ok) {
        setLoginError(data.error || 'تعذر تسجيل الدخول')
        return
      }
      if (data.requires2FA) {
        setNeeds2fa(true)
        return
      }
      await finishLogin(data)
    } catch {
      setLoginError('تعذر الاتصال بالخادم')
    } finally {
      setLoginBusy(false)
    }
  }

  async function finishLogin(data: { user?: { isPlatformAdmin?: boolean; email?: string } }) {
    if (!data.user?.isPlatformAdmin) {
      await fetch('/api/auth/logout', { method: 'POST' })
      setNeeds2fa(false)
      setLoginError('هذه اللوحة متاحة لمدير منصة دُسْتُورِي فقط — ويتطلب الحساب بريداً مؤكداً ومصادقة ثنائية مفعّلة')
      return
    }
    setAuthEmail(data.user.email ?? '')
    setLoggedIn(true)
  }

  const verify2fa = async () => {
    if (!/^\d{6}$/.test(totpCode.trim())) { setLoginError('أدخل رمز التحقق المكوّن من 6 أرقام'); return }
    setLoginBusy(true)
    setLoginError('')
    try {
      const res = await fetch('/api/auth/2fa/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: totpCode.trim() }),
      })
      const data = await res.json()
      if (!res.ok) { setLoginError(data.error || 'رمز التحقق غير صحيح'); return }
      await finishLogin(data)
    } catch {
      setLoginError('تعذر الاتصال بالخادم')
    } finally {
      setLoginBusy(false)
    }
  }

  const logout = async () => {
    await fetch('/api/auth/logout', { method: 'POST' })
    setLoggedIn(false)
    setAuthEmail('')
  }

  const saveTicker = () => {
    if (tickerItems.length === 0) { alert('أضف نصاً واحداً على الأقل للشريط'); return }
    patchSiteSettings(
      { tickerItems, tickerBg, tickerColor, tickerSpeed },
      '✓ تم حفظ شريط الإعلانات وتطبيقه على الصفحة الرئيسية'
    )
  }

  const saveVideo = () => {
    const url = vtab === 'yt' ? ytUrl : mp4Url
    if (!url) { alert('أدخل رابطاً أولاً'); return }
    patchSiteSettings(
      { heroVideo: { type: vtab, url, autoplay, loop, controls } },
      '✓ تم حفظ الفيديو وسيظهر على الصفحة الرئيسية عند تحديثها'
    )
  }

  /* ── Styles ── */
  const S = {
    body: { fontFamily: "'Cairo',sans-serif", background: '#0A0F1A', color: '#E2E8F0', minHeight: '100vh' } as React.CSSProperties,
    card: { background: '#111827', border: '1px solid rgba(255,255,255,.06)', borderRadius: 14, padding: 20 } as React.CSSProperties,
    inp: { width: '100%', background: '#1F2937', border: '1px solid rgba(255,255,255,.08)', borderRadius: 9, padding: '10px 14px', color: '#E2E8F0', fontFamily: "'Cairo',sans-serif", fontSize: '.88rem', outline: 'none' } as React.CSSProperties,
    label: { fontSize: '.78rem', color: '#94A3B8', display: 'block', marginBottom: 5 } as React.CSSProperties,
    sec: { fontSize: '.78rem', fontWeight: 800, color: '#64748B', letterSpacing: '.5px', textTransform: 'uppercase', marginBottom: 14 } as React.CSSProperties,
    tinyBtn: { background: 'rgba(255,255,255,.04)', border: '1px solid rgba(255,255,255,.1)', borderRadius: 6, padding: '4px 9px', fontFamily: "'Cairo',sans-serif", fontSize: '.7rem', fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap' } as React.CSSProperties,
    btnRed: { background: 'linear-gradient(135deg,#EF4444,#DC2626)', color: '#fff', padding: '8px 16px', borderRadius: 9, fontFamily: "'Cairo',sans-serif", fontSize: '.82rem', fontWeight: 700, cursor: 'pointer', border: 'none' } as React.CSSProperties,
    btnGold: { background: 'linear-gradient(135deg,#D4AF37,#C5A059)', color: '#0A0F1A', padding: '8px 16px', borderRadius: 9, fontFamily: "'Cairo',sans-serif", fontSize: '.82rem', fontWeight: 700, cursor: 'pointer', border: 'none' } as React.CSSProperties,
  }

  /* ─── Login Screen ──────────────────── */
  if (!loggedIn) {
    return (
      <div style={{ ...S.body, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ background: '#111827', border: '1px solid rgba(239,68,68,.15)', borderRadius: 20, padding: '40px 36px', width: 400, boxShadow: '0 24px 64px rgba(0,0,0,.5)' }}>
          <div style={{ textAlign: 'center', marginBottom: 28 }}>
            <div style={{ fontSize: '1.8rem', fontWeight: 900, background: 'linear-gradient(135deg,#D4AF37,#C5A059)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>دُسْتُورِي</div>
            <div style={{ fontSize: '.8rem', color: '#64748B', marginTop: 2 }}>DOSTOORI LEGAL</div>
            <span style={{ display: 'inline-block', background: 'rgba(239,68,68,.1)', border: '1px solid rgba(239,68,68,.25)', color: '#EF4444', fontSize: '.72rem', fontWeight: 700, padding: '3px 10px', borderRadius: 20, marginTop: 6 }}>🔒 لوحة الإدارة — Admin Panel</span>
          </div>
          {!needs2fa ? [{ label: 'البريد الإلكتروني', value: email, set: setEmail, type: 'email', placeholder: 'you@example.com' }, { label: 'كلمة المرور', value: password, set: setPassword, type: 'password', placeholder: '••••••••' }].map((f) => (
            <div key={f.label} style={{ marginBottom: 14 }}>
              <label style={S.label}>{f.label}</label>
              <input type={f.type} value={f.value} onChange={(e) => f.set(e.target.value)} placeholder={f.placeholder} onKeyDown={(e) => e.key === 'Enter' && login()} style={{ ...S.inp, borderColor: 'rgba(255,255,255,.07)' }} />
            </div>
          )) : (
            <div style={{ marginBottom: 14 }}>
              <label style={S.label}>رمز المصادقة الثنائية (6 أرقام)</label>
              <input inputMode="numeric" autoComplete="one-time-code" value={totpCode} onChange={(e) => setTotpCode(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && verify2fa()} style={{ ...S.inp, borderColor: 'rgba(255,255,255,.07)', direction: 'ltr', textAlign: 'center', letterSpacing: 4 }} />
            </div>
          )}
          {loginError && <div style={{ color: '#F87171', fontSize: '.8rem', textAlign: 'center', marginBottom: 10 }}>{loginError}</div>}
          <button onClick={needs2fa ? verify2fa : login} disabled={loginBusy} style={{ width: '100%', background: 'linear-gradient(135deg,#EF4444,#DC2626)', border: 'none', borderRadius: 10, padding: 13, color: '#fff', fontFamily: "'Cairo',sans-serif", fontSize: '1rem', fontWeight: 800, cursor: loginBusy ? 'wait' : 'pointer', marginTop: 6, opacity: loginBusy ? .8 : 1 }}>
            {loginBusy ? 'جارٍ التحقق...' : needs2fa ? 'تأكيد الرمز' : 'دخول إلى لوحة الإدارة'}
          </button>
          <div style={{ textAlign: 'center', fontSize: '.73rem', color: '#374151', marginTop: 16 }}>هذه الصفحة مخصصة لفريق دُسْتُورِي فقط</div>
        </div>
      </div>
    )
  }

  /* ─── App ───────────────────────────── */
  const navItems: { id: Page; icon: string; label: string; group: string; badge?: string }[] = [
    { id: 'overview', icon: '📊', label: 'لوحة التحكم', group: 'الرئيسية' },
    { id: 'ticker',   icon: '📢', label: 'شريط الإعلانات', group: 'المحتوى' },
    { id: 'homepage', icon: '🎬', label: 'الصفحة الرئيسية', group: '' },
    { id: 'subs',     icon: '👥', label: 'المشتركون', group: 'العملاء', badge: subscribers.length ? String(subscribers.length) : undefined },
    { id: 'trials',   icon: '🕐', label: 'التجارب المجانية', group: '', badge: trialRequests.length ? String(trialRequests.length) : undefined },
    { id: 'settings', icon: '⚙️', label: 'الإعدادات', group: 'النظام' },
  ]

  return (
    <div style={S.body}>
      {toast && <Toast msg={toast} onDone={() => setToast('')} />}

      {/* Top bar */}
      <div style={{ height: 54, background: '#111827', borderBottom: '1px solid rgba(239,68,68,.12)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 24px', position: 'sticky', top: 0, zIndex: 100 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: '1.1rem', fontWeight: 900, background: 'linear-gradient(135deg,#D4AF37,#C5A059)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>دُسْتُورِي</span>
          <span style={{ background: 'rgba(239,68,68,.12)', border: '1px solid rgba(239,68,68,.25)', color: '#EF4444', fontSize: '.72rem', fontWeight: 700, padding: '2px 9px', borderRadius: 12 }}>Admin Panel</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ fontSize: '.78rem', color: '#64748B' }}>{authEmail || 'مدير المكتب'}</span>
          <div style={{ width: 32, height: 32, borderRadius: '50%', background: 'linear-gradient(135deg,#EF4444,#DC2626)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '.85rem', fontWeight: 900 }}>A</div>
          <button onClick={logout} style={{ background: 'none', border: '1px solid rgba(239,68,68,.3)', color: '#EF4444', fontFamily: "'Cairo',sans-serif", fontSize: '.78rem', fontWeight: 700, padding: '5px 12px', borderRadius: 8, cursor: 'pointer' }}>⬅ خروج</button>
        </div>
      </div>

      <div style={{ display: 'flex', minHeight: 'calc(100vh - 54px)' }}>

        {/* Sidebar */}
        <div style={{ width: 220, background: '#111827', borderLeft: '1px solid rgba(255,255,255,.05)', padding: '16px 0', flexShrink: 0 }}>
          {navItems.map((item, i) => {
            const prevGroup = i > 0 ? navItems[i-1].group : null
            return (
              <div key={item.id}>
                {item.group && item.group !== prevGroup && (
                  <div style={{ fontSize: '.68rem', fontWeight: 700, color: '#374151', letterSpacing: '.8px', padding: '10px 18px 4px', textTransform: 'uppercase' }}>{item.group}</div>
                )}
                <div
                  onClick={() => setPage(item.id)}
                  style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '9px 18px', fontSize: '.84rem', fontWeight: page === item.id ? 700 : 600, color: page === item.id ? '#EF4444' : '#94A3B8', cursor: 'pointer', borderRight: page === item.id ? '3px solid #EF4444' : '3px solid transparent', background: page === item.id ? 'rgba(239,68,68,.08)' : 'transparent' }}
                >
                  <span>{item.icon}</span>
                  {item.label}
                  {item.badge && <span style={{ fontSize: '.65rem', background: 'rgba(16,185,129,.1)', color: '#10B981', border: '1px solid rgba(16,185,129,.3)', padding: '1px 6px', borderRadius: 12, marginRight: 'auto' }}>{item.badge}</span>}
                </div>
              </div>
            )
          })}
        </div>

        {/* Main */}
        <div style={{ flex: 1, padding: 28, overflowY: 'auto' }}>

          {/* Overview */}
          {page === 'overview' && (
            <div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
                <div><h1 style={{ fontSize: '1.25rem', fontWeight: 900, color: '#F1F5F9' }}>📊 لوحة التحكم</h1><p style={{ fontSize: '.8rem', color: '#64748B', marginTop: 3 }}>نظرة عامة على اشتراكات المكاتب وطلبات التجربة</p></div>
                <button onClick={() => location.reload()} style={S.btnGold}>↻ تحديث</button>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 14, marginBottom: 22 }}>
                {[
                  { n: stats?.subscribedOffices, l: 'مكتب مشترك (نشط + تجربة)', c: '#10B981' },
                  { n: stats?.trialingOffices, l: 'تجربة نشطة', c: '#D4AF37' },
                  { n: stats?.newTrialRequests, l: 'طلب تجربة جديد', c: '#60A5FA' },
                  { n: stats?.pastDueOffices, l: 'اشتراك متأخر', c: '#EF4444' },
                ].map((s) => (
                  <div key={s.l} style={{ ...S.card, textAlign: 'center' }}>
                    <div style={{ fontSize: '1.8rem', fontWeight: 900, marginBottom: 4, color: s.c }}>{s.n ?? '…'}</div>
                    <div style={{ fontSize: '.75rem', color: '#64748B' }}>{s.l}</div>
                  </div>
                ))}
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                <div style={S.card}>
                  <div style={S.sec}>📊 توزيع حالات الاشتراك</div>
                  {stats ? (() => {
                    const rows = [
                      { label: 'نشط', n: stats.activeOffices, c: '#10B981' },
                      { label: 'تجربة', n: stats.trialingOffices, c: '#D4AF37' },
                      { label: 'متأخر', n: stats.pastDueOffices, c: '#EF4444' },
                      { label: 'ملغى', n: stats.canceledOffices, c: '#64748B' },
                    ]
                    const max = Math.max(1, ...rows.map((r) => r.n))
                    return rows.map((row) => (
                      <div key={row.label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '.8rem', marginBottom: 8 }}>
                        <span style={{ color: row.c, fontWeight: 700, minWidth: 24 }}>{row.n}</span>
                        <div style={{ flex: 1, margin: '0 12px', background: '#1F2937', borderRadius: 3, height: 8, overflow: 'hidden' }}>
                          <div style={{ width: `${(row.n / max) * 100}%`, height: '100%', background: row.c, borderRadius: 3 }} />
                        </div>
                        <span>{row.label}</span>
                      </div>
                    ))
                  })() : <div style={{ color: '#64748B', fontSize: '.8rem' }}>جارٍ التحميل…</div>}
                </div>
                <div style={S.card}>
                  <div style={S.sec}>🆕 أحدث المكاتب المسجّلة</div>
                  {subscribers.slice(0, 6).map((office) => (
                    <div key={office.officeId} style={{ fontSize: '.8rem', padding: 8, borderRadius: 7, borderRight: '3px solid #60A5FA', background: '#60A5FA0d', marginBottom: 9 }}>
                      <span style={{ color: '#E2E8F0', fontWeight: 700 }}>{office.officeName}</span><br />
                      <span style={{ color: '#94A3B8' }}>{(office.managerName ?? '—') + ' · ' + SUB_STATUS_BADGE[office.status].label}</span><br />
                      <span style={{ color: '#374151', fontSize: '.71rem' }}>{fmtDate(office.createdAt)}</span>
                    </div>
                  ))}
                  {subscribers.length === 0 && <div style={{ color: '#64748B', fontSize: '.8rem' }}>لا توجد مكاتب مسجّلة بعد</div>}
                </div>
              </div>
            </div>
          )}

          {/* Ticker */}
          {page === 'ticker' && (
            <div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
                <div><h1 style={{ fontSize: '1.25rem', fontWeight: 900, color: '#F1F5F9' }}>📢 شريط الإعلانات</h1><p style={{ fontSize: '.8rem', color: '#64748B', marginTop: 3 }}>التحكم بما يظهر في الشريط العلوي على الصفحة الرئيسية</p></div>
                <button onClick={saveTicker} style={S.btnGold}>💾 حفظ وتطبيق</button>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                <div style={S.card}>
                  <div style={{ fontSize: '.78rem', fontWeight: 800, color: '#64748B', letterSpacing: '.5px', textTransform: 'uppercase', marginBottom: 14 }}>🗒 إدارة النصوص</div>
                  {tickerItems.map((item, i) => (
                    <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', background: '#1F2937', border: '1px solid rgba(255,255,255,.07)', borderRadius: 9, marginBottom: 8 }}>
                      <span style={{ color: '#374151' }}>⠿</span>
                      <span style={{ flex: 1, color: '#E2E8F0', fontSize: '.84rem' }}>{item}</span>
                      <button onClick={() => setTickerItems(tickerItems.filter((_, j) => j !== i))} style={{ background: 'none', border: 'none', color: '#EF4444', cursor: 'pointer', fontSize: '1rem' }}>✕</button>
                    </div>
                  ))}
                  <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                    <input value={newTickerText} onChange={(e) => setNewTickerText(e.target.value)} placeholder="✦ نص جديد للشريط..." style={{ ...S.inp, flex: 1 }} />
                    <button onClick={() => { if (newTickerText.trim()) { setTickerItems([...tickerItems, newTickerText.trim()]); setNewTickerText('') } }} style={S.btnRed}>+ إضافة</button>
                  </div>
                </div>
                <div>
                  <div style={{ ...S.card, marginBottom: 14 }}>
                    <div style={{ fontSize: '.78rem', fontWeight: 800, color: '#64748B', letterSpacing: '.5px', textTransform: 'uppercase', marginBottom: 14 }}>⚙️ إعدادات الشريط</div>
                    <div style={{ marginBottom: 14 }}>
                      <label style={S.label}>لون الخلفية</label>
                      <div style={{ display: 'flex', gap: 8 }}>
                        <input type="color" value={tickerBg} onChange={(e) => setTickerBg(e.target.value)} style={{ width: 48, height: 32, border: 'none', borderRadius: 6, cursor: 'pointer', background: 'none', padding: 0 }} />
                        <input value={tickerBg} onChange={(e) => setTickerBg(e.target.value)} style={{ ...S.inp, flex: 1 }} />
                      </div>
                    </div>
                    <div style={{ marginBottom: 14 }}>
                      <label style={S.label}>لون النص</label>
                      <div style={{ display: 'flex', gap: 8 }}>
                        <input type="color" value={tickerColor} onChange={(e) => setTickerColor(e.target.value)} style={{ width: 48, height: 32, border: 'none', borderRadius: 6, cursor: 'pointer', background: 'none', padding: 0 }} />
                        <input value={tickerColor} onChange={(e) => setTickerColor(e.target.value)} style={{ ...S.inp, flex: 1 }} />
                      </div>
                    </div>
                    <div>
                      <label style={S.label}>سرعة الحركة ({tickerSpeed} ثانية)</label>
                      <input type="range" min="15" max="80" value={tickerSpeed} onChange={(e) => setTickerSpeed(Number(e.target.value))} style={{ width: '100%', accentColor: '#EF4444' }} />
                    </div>
                  </div>
                  <div style={S.card}>
                    <div style={{ fontSize: '.78rem', fontWeight: 800, color: '#64748B', letterSpacing: '.5px', textTransform: 'uppercase', marginBottom: 14 }}>👁 معاينة مباشرة</div>
                    <div style={{ background: tickerBg, borderRadius: 8, padding: '10px 0', overflow: 'hidden' }}>
                      <div style={{ color: tickerColor, fontSize: '.78rem', whiteSpace: 'nowrap', animation: `ticker ${tickerSpeed}s linear infinite`, padding: '0 16px' }}>
                        {tickerItems.join('     ')}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Homepage / video */}
          {page === 'homepage' && (
            <div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
                <div><h1 style={{ fontSize: '1.25rem', fontWeight: 900, color: '#F1F5F9' }}>🎬 الصفحة الرئيسية</h1><p style={{ fontSize: '.8rem', color: '#64748B', marginTop: 3 }}>تحكم بالفيديو التجريبي الظاهر في قسم البطل</p></div>
                <button onClick={saveVideo} style={S.btnGold}>💾 حفظ وتطبيق</button>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                <div style={S.card}>
                  <div style={{ fontSize: '.78rem', fontWeight: 800, color: '#64748B', letterSpacing: '.5px', textTransform: 'uppercase', marginBottom: 14 }}>📹 مصدر الفيديو</div>
                  <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
                    {(['yt', 'mp4'] as VTab[]).map((t) => (
                      <button key={t} onClick={() => setVtab(t)} style={{ padding: '7px 16px', borderRadius: 8, fontFamily: "'Cairo',sans-serif", fontSize: '.82rem', fontWeight: 700, cursor: 'pointer', border: `1px solid ${vtab === t ? 'rgba(239,68,68,.3)' : 'rgba(255,255,255,.08)'}`, background: vtab === t ? 'rgba(239,68,68,.12)' : 'rgba(255,255,255,.04)', color: vtab === t ? '#EF4444' : '#64748B' }}>
                        {t === 'yt' ? '🔗 رابط YouTube' : '📁 رابط mp4 مباشر'}
                      </button>
                    ))}
                  </div>
                  {vtab === 'yt' ? (
                    <div>
                      <label style={S.label}>رابط YouTube</label>
                      <input value={ytUrl} onChange={(e) => setYtUrl(e.target.value)} placeholder="https://www.youtube.com/watch?v=XXXXXXX" style={S.inp} />
                    </div>
                  ) : (
                    <div>
                      <label style={S.label}>رابط الفيديو المباشر (mp4)</label>
                      <input value={mp4Url} onChange={(e) => setMp4Url(e.target.value)} placeholder="https://yourcdn.com/demo.mp4" style={S.inp} />
                    </div>
                  )}
                  <div style={{ marginTop: 16, padding: 12, background: 'rgba(212,175,55,.06)', border: '1px solid rgba(212,175,55,.15)', borderRadius: 9 }}>
                    <div style={{ fontSize: '.78rem', fontWeight: 700, color: '#D4AF37', marginBottom: 6 }}>⚙️ خيارات العرض</div>
                    {[{ label: 'تشغيل تلقائي (muted)', val: autoplay, set: setAutoplay }, { label: 'تكرار', val: loop, set: setLoop }, { label: 'إظهار أدوات التحكم', val: controls, set: setControls }].map((opt) => (
                      <label key={opt.label} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '.8rem', cursor: 'pointer', marginBottom: 8 }}>
                        <input type="checkbox" checked={opt.val} onChange={(e) => opt.set(e.target.checked)} style={{ accentColor: '#EF4444' }} /> {opt.label}
                      </label>
                    ))}
                  </div>
                </div>
                <div style={S.card}>
                  <div style={{ fontSize: '.78rem', fontWeight: 800, color: '#64748B', letterSpacing: '.5px', textTransform: 'uppercase', marginBottom: 14 }}>👁 معاينة الفيديو</div>
                  <div style={{ background: '#000', borderRadius: 12, overflow: 'hidden', aspectRatio: '16/9', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    {(vtab === 'yt' && ytUrl) ? (
                      <iframe src={ytToEmbed(ytUrl) + '?autoplay=0&mute=1'} style={{ width: '100%', height: '100%', border: 'none' }} allowFullScreen />
                    ) : (vtab === 'mp4' && mp4Url) ? (
                      <video src={mp4Url} controls style={{ width: '100%', height: '100%' }} />
                    ) : (
                      <div style={{ color: '#374151', fontSize: '2rem', textAlign: 'center' }}><div>🎬</div><p style={{ fontSize: '.82rem', marginTop: 8 }}>أدخل رابط الفيديو للمعاينة</p></div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Subscribers */}
          {page === 'subs' && (() => {
            const q = subSearch.trim().toLowerCase()
            const filtered = subscribers.filter((row) => {
              if (subStatusFilter !== 'ALL' && row.status !== subStatusFilter) return false
              if (q && !`${row.officeName} ${row.managerName ?? ''} ${row.managerEmail ?? ''}`.toLowerCase().includes(q)) return false
              return true
            })
            return (
              <div>
                <div style={{ marginBottom: 24 }}>
                  <h1 style={{ fontSize: '1.25rem', fontWeight: 900, color: '#F1F5F9' }}>👥 المشتركون</h1>
                  <p style={{ fontSize: '.8rem', color: '#64748B', marginTop: 3 }}>
                    {stats ? `${stats.totalOffices} مكتب مسجّل — ${stats.subscribedOffices} باشتراك نشط أو تجربة` : 'جارٍ التحميل…'}
                  </p>
                </div>
                <div style={S.card}>
                  <div style={{ display: 'flex', gap: 10, marginBottom: 16 }}>
                    <input value={subSearch} onChange={(e) => setSubSearch(e.target.value)} placeholder="🔍 بحث بالاسم أو البريد..." style={{ ...S.inp, flex: 1, maxWidth: 320 }} />
                    <select value={subStatusFilter} onChange={(e) => setSubStatusFilter(e.target.value as 'ALL' | SubStatus)} style={{ ...S.inp, maxWidth: 180 }}>
                      <option value="ALL">كل الحالات</option>
                      <option value="ACTIVE">نشط</option>
                      <option value="TRIALING">تجربة</option>
                      <option value="PAST_DUE">متأخر</option>
                      <option value="CANCELED">ملغى</option>
                      <option value="NONE">بلا اشتراك</option>
                    </select>
                  </div>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '.82rem' }}>
                    <thead>
                      <tr>
                        {['#','المكتب','المدير المسؤول','الباقة','الحالة','التجديد / انتهاء التجربة','أُنشئ',''].map((h) => (
                          <th key={h} style={{ textAlign: 'right', padding: '9px 12px', color: '#64748B', fontWeight: 700, fontSize: '.75rem', borderBottom: '1px solid rgba(255,255,255,.06)' }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {filtered.map((row, i) => {
                        const badge = SUB_STATUS_BADGE[row.status] ?? SUB_STATUS_BADGE.NONE
                        const busy = actionBusy?.startsWith(row.officeId) ?? false
                        return (
                          <tr key={row.officeId} style={{ borderBottom: '1px solid rgba(255,255,255,.04)' }}>
                            <td style={{ padding: '10px 12px', color: '#CBD5E1' }}>{i + 1}</td>
                            <td style={{ padding: '10px 12px', color: '#E2E8F0', fontWeight: 700 }}>
                              {row.officeName}
                              {!row.officeActive && <span style={{ color: '#EF4444', fontSize: '.7rem', marginRight: 6 }}>(معطّل)</span>}
                            </td>
                            <td style={{ padding: '10px 12px', color: '#CBD5E1' }}>{row.managerName ?? '—'}</td>
                            <td style={{ padding: '10px 12px', color: '#CBD5E1' }}>{row.plan ?? '—'}</td>
                            <td style={{ padding: '10px 12px' }}><Bx type={badge.type} label={badge.label} /></td>
                            <td style={{ padding: '10px 12px', color: '#CBD5E1' }}>{fmtDate(row.renewsAt)}</td>
                            <td style={{ padding: '10px 12px', color: '#CBD5E1' }}>{fmtDate(row.createdAt)}</td>
                            <td style={{ padding: '10px 12px', display: 'flex', gap: 6 }}>
                              <button
                                disabled={busy}
                                onClick={() => runOfficeAction(row.officeId, 'activate', `✓ تم تفعيل اشتراك ${row.officeName}`)}
                                style={{ ...S.tinyBtn, color: '#10B981', borderColor: 'rgba(16,185,129,.3)', opacity: busy ? 0.5 : 1 }}
                              >تفعيل</button>
                              <button
                                disabled={busy}
                                onClick={() => runOfficeAction(row.officeId, 'extend-trial', `✓ تم تمديد تجربة ${row.officeName}`)}
                                style={{ ...S.tinyBtn, color: '#60A5FA', borderColor: 'rgba(96,165,250,.3)', opacity: busy ? 0.5 : 1 }}
                              >تمديد</button>
                              <button
                                disabled={busy}
                                onClick={() => { if (confirm(`تعليق اشتراك ${row.officeName}؟ سيفقد المكتب الوصول فوراً.`)) runOfficeAction(row.officeId, 'suspend', `✓ تم تعليق اشتراك ${row.officeName}`) }}
                                style={{ ...S.tinyBtn, color: '#EF4444', borderColor: 'rgba(239,68,68,.3)', opacity: busy ? 0.5 : 1 }}
                              >تعليق</button>
                            </td>
                          </tr>
                        )
                      })}
                      {filtered.length === 0 && (
                        <tr><td colSpan={8} style={{ padding: '20px 12px', textAlign: 'center', color: '#64748B' }}>
                          {subscribers.length === 0 ? 'لا توجد مكاتب مسجّلة بعد' : 'لا نتائج مطابقة'}
                        </td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            )
          })()}

          {/* Trials */}
          {page === 'trials' && (
            <div>
              <div style={{ marginBottom: 24 }}><h1 style={{ fontSize: '1.25rem', fontWeight: 900, color: '#F1F5F9' }}>🕐 طلبات التجربة المجانية</h1><p style={{ fontSize: '.8rem', color: '#64748B', marginTop: 3 }}>{trialRequests.length} طلب</p></div>
              <div style={S.card}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '.82rem' }}>
                  <thead>
                    <tr>
                      {['المكتب','المحامي','رقم الجوال','المدينة','تاريخ الطلب','الحالة'].map((h) => (
                        <th key={h} style={{ textAlign: 'right', padding: '9px 12px', color: '#64748B', fontWeight: 700, fontSize: '.75rem', borderBottom: '1px solid rgba(255,255,255,.06)' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {trialRequests.map((row) => (
                      <tr key={row.id} style={{ borderBottom: '1px solid rgba(255,255,255,.04)' }}>
                        <td style={{ padding: '10px 12px', color: '#E2E8F0', fontWeight: 700 }}>{row.officeName}</td>
                        <td style={{ padding: '10px 12px', color: '#CBD5E1' }}>{row.lawyerName}</td>
                        <td style={{ padding: '10px 12px', color: '#CBD5E1', direction: 'ltr', textAlign: 'right' }}>{row.mobile}</td>
                        <td style={{ padding: '10px 12px', color: '#CBD5E1' }}>{row.city}</td>
                        <td style={{ padding: '10px 12px', color: '#CBD5E1' }}>{fmtDate(row.createdAt)}</td>
                        <td style={{ padding: '10px 12px' }}><Bx type={row.status === 'NEW' ? 'y' : 'b'} label={row.status === 'NEW' ? 'جديد' : row.status} /></td>
                      </tr>
                    ))}
                    {trialRequests.length === 0 && (
                      <tr><td colSpan={6} style={{ padding: '20px 12px', textAlign: 'center', color: '#64748B' }}>لا توجد طلبات تجربة بعد</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Settings */}
          {page === 'settings' && (
            <div>
              <div style={{ marginBottom: 24 }}><h1 style={{ fontSize: '1.25rem', fontWeight: 900, color: '#F1F5F9' }}>⚙️ إعدادات النظام</h1><p style={{ fontSize: '.8rem', color: '#64748B', marginTop: 3 }}>التحكم بمعلومات التواصل التي تظهر على الموقع</p></div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>

                {/* Contact settings — live */}
                <div style={S.card}>
                  <div style={{ fontSize: '.78rem', fontWeight: 800, color: '#64748B', letterSpacing: '.5px', textTransform: 'uppercase', marginBottom: 14 }}>📱 بيانات التواصل — الموقع الإلكتروني</div>
                  <div style={{ marginBottom: 14 }}>
                    <label style={S.label}>رقم واتساب (أرقام فقط — للرابط wa.me)</label>
                    <input value={ctWa} onChange={(e) => setCtWa(e.target.value)} placeholder="9627900000001" style={{ ...S.inp, direction: 'ltr' }} />
                    <div style={{ fontSize: '.7rem', color: '#374151', marginTop: 4 }}>يظهر في زر الدعم الأخضر + شريط الإعلانات</div>
                  </div>
                  <div style={{ marginBottom: 14 }}>
                    <label style={S.label}>رقم الهاتف (صيغة العرض)</label>
                    <input value={ctPhone} onChange={(e) => setCtPhone(e.target.value)} placeholder="+962 79 000 0000" style={{ ...S.inp, direction: 'ltr' }} />
                    <div style={{ fontSize: '.7rem', color: '#374151', marginTop: 4 }}>يظهر في شريط الإعلانات وتذييل الصفحة</div>
                  </div>
                  <div style={{ marginBottom: 18 }}>
                    <label style={S.label}>البريد الإلكتروني</label>
                    <input value={ctEmail} onChange={(e) => setCtEmail(e.target.value)} placeholder="info@dostoori.jo" style={{ ...S.inp, direction: 'ltr' }} />
                    <div style={{ fontSize: '.7rem', color: '#374151', marginTop: 4 }}>يظهر في تذييل الصفحة</div>
                  </div>
                  <button style={S.btnGold} onClick={saveContact}>💾 حفظ وتطبيق على الموقع</button>
                </div>

                {/* Preview + admin credentials */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                  <div style={{ ...S.card, background: 'rgba(212,175,55,.05)', border: '1px solid rgba(212,175,55,.12)' }}>
                    <div style={{ fontSize: '.78rem', fontWeight: 800, color: '#D4AF37', letterSpacing: '.5px', textTransform: 'uppercase', marginBottom: 12 }}>👁 معاينة مباشرة</div>
                    <div style={{ fontSize: '.83rem', lineHeight: 2.2, color: '#94A3B8' }}>
                      <div>🔗 <span style={{ color: '#60A5FA', fontFamily: 'monospace' }}>wa.me/{ctWa || '9627...'}</span></div>
                      <div>📞 <span style={{ color: '#E2E8F0' }}>{ctPhone || '+962 ...'}</span></div>
                      <div>✉️ <span style={{ color: '#E2E8F0' }}>{ctEmail || 'info@...'}</span></div>
                    </div>
                  </div>
                  <div style={S.card}>
                    <div style={{ fontSize: '.78rem', fontWeight: 800, color: '#64748B', letterSpacing: '.5px', textTransform: 'uppercase', marginBottom: 14 }}>👤 حساب مدير المنصة</div>
                    <div style={{ fontSize: '.83rem', lineHeight: 2, color: '#94A3B8' }}>
                      <div>الحساب الحالي: <span style={{ color: '#E2E8F0', fontFamily: 'monospace' }}>{authEmail || '—'}</span></div>
                    </div>
                    <div style={{ marginTop: 12, padding: 12, background: 'rgba(96,165,250,.06)', border: '1px solid rgba(96,165,250,.15)', borderRadius: 9, fontSize: '.78rem', color: '#94A3B8', lineHeight: 1.9 }}>
                      صلاحية مدير المنصة تُمنَح لأي مدير مكتب بريده مُدرَج في متغيّر البيئة <span style={{ color: '#60A5FA', fontFamily: 'monospace' }}>PLATFORM_ADMIN_EMAILS</span> على الخادم. لتغيير كلمة المرور استخدم «نسيت كلمة المرور» في صفحة الدخول.
                    </div>
                  </div>
                </div>

              </div>
            </div>
          )}

        </div>
      </div>

      <style>{`@keyframes ticker { 0%{transform:translateX(100vw)} 100%{transform:translateX(-100%)} }`}</style>
    </div>
  )
}
