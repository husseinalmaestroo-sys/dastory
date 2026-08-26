'use client'

import { useState, useEffect } from 'react'

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
  status: 'NEW'
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
      .catch(() => {})
  }, [])

  useEffect(() => {
    if (!loggedIn) return
    fetch('/api/trial-requests')
      .then((res) => res.ok ? res.json() : [])
      .then((data) => { if (Array.isArray(data)) setTrialRequests(data) })
      .catch(() => {})
  }, [loggedIn])

  /* Load from localStorage on mount */
  useEffect(() => {
    const saved = localStorage.getItem('dstoori_ticker_items')
    if (saved) setTickerItems(JSON.parse(saved))
    const savedVid = localStorage.getItem('dstoori_hero_video')
    if (savedVid) {
      const v = JSON.parse(savedVid)
      if (v.type === 'mp4') setMp4Url(v.url); else setYtUrl(v.url)
      setAutoplay(v.autoplay ?? true)
      setLoop(v.loop ?? true)
      setControls(v.controls ?? false)
    }
    const savedContact = localStorage.getItem('dstoori_contact_v1')
    if (savedContact) {
      const c = JSON.parse(savedContact)
      if (c.phone)    setCtPhone(c.phone)
      if (c.whatsapp) setCtWa(c.whatsapp)
      if (c.email)    setCtEmail(c.email)
    }
  }, [])

  const saveContact = () => {
    const contact = { phone: ctPhone, whatsapp: ctWa.replace(/\D/g, ''), email: ctEmail }
    localStorage.setItem('dstoori_contact_v1', JSON.stringify(contact))
    setCtWa(contact.whatsapp)
    window.dispatchEvent(new Event('dstoori_contact_updated'))
    setToast('✓ تم حفظ بيانات التواصل وتطبيقها على الموقع')
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
      if (!data.user?.isPlatformAdmin) {
        await fetch('/api/auth/logout', { method: 'POST' })
        setLoginError('هذه اللوحة متاحة لمدير منصة دُسْتُورِي فقط')
        return
      }
      setAuthEmail(data.user.email)
      setLoggedIn(true)
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
    localStorage.setItem('dstoori_ticker_items', JSON.stringify(tickerItems))
    localStorage.setItem('dstoori_ticker_bg', tickerBg)
    localStorage.setItem('dstoori_ticker_color', tickerColor)
    localStorage.setItem('dstoori_ticker_speed', String(tickerSpeed))
    setToast('✓ تم حفظ شريط الإعلانات وتطبيقه على الصفحة الرئيسية')
  }

  const saveVideo = () => {
    const url = vtab === 'yt' ? ytUrl : mp4Url
    if (!url) { alert('أدخل رابطاً أولاً'); return }
    localStorage.setItem('dstoori_hero_video', JSON.stringify({ type: vtab, url, autoplay, loop, controls }))
    setToast('✓ تم حفظ الفيديو وسيظهر على الصفحة الرئيسية عند تحديثها')
  }

  /* ── Styles ── */
  const S = {
    body: { fontFamily: "'Cairo',sans-serif", background: '#0A0F1A', color: '#E2E8F0', minHeight: '100vh' } as React.CSSProperties,
    card: { background: '#111827', border: '1px solid rgba(255,255,255,.06)', borderRadius: 14, padding: 20 } as React.CSSProperties,
    inp: { width: '100%', background: '#1F2937', border: '1px solid rgba(255,255,255,.08)', borderRadius: 9, padding: '10px 14px', color: '#E2E8F0', fontFamily: "'Cairo',sans-serif", fontSize: '.88rem', outline: 'none' } as React.CSSProperties,
    label: { fontSize: '.78rem', color: '#94A3B8', display: 'block', marginBottom: 5 } as React.CSSProperties,
    btnRed: { background: 'linear-gradient(135deg,#EF4444,#DC2626)', color: '#fff', padding: '8px 16px', borderRadius: 9, fontFamily: "'Cairo',sans-serif", fontSize: '.82rem', fontWeight: 700, cursor: 'pointer', border: 'none' } as React.CSSProperties,
    btnGold: { background: 'linear-gradient(135deg,#D4AF37,#C5A059)', color: '#0A0F1A', padding: '8px 16px', borderRadius: 9, fontFamily: "'Cairo',sans-serif", fontSize: '.82rem', fontWeight: 700, cursor: 'pointer', border: 'none' } as React.CSSProperties,
    btnGhost: { background: 'rgba(255,255,255,.06)', color: '#94A3B8', border: '1px solid rgba(255,255,255,.08)', padding: '8px 16px', borderRadius: 9, fontFamily: "'Cairo',sans-serif", fontSize: '.82rem', fontWeight: 700, cursor: 'pointer' } as React.CSSProperties,
  }

  const Bx = ({ type, label }: { type: 'g'|'r'|'y'|'b'; label: string }) => {
    const map = { g: { c: '#10B981', bg: 'rgba(16,185,129,.07)', bc: 'rgba(16,185,129,.3)' }, r: { c: '#EF4444', bg: 'rgba(239,68,68,.07)', bc: 'rgba(239,68,68,.3)' }, y: { c: '#F59E0B', bg: 'rgba(245,158,11,.07)', bc: 'rgba(245,158,11,.3)' }, b: { c: '#60A5FA', bg: 'rgba(96,165,250,.07)', bc: 'rgba(96,165,250,.3)' } }
    const s = map[type]
    return <span style={{ display: 'inline-block', fontSize: '.71rem', fontWeight: 700, padding: '2px 8px', borderRadius: 20, border: `1px solid ${s.bc}`, background: s.bg, color: s.c }}>{label}</span>
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
          {[{ label: 'البريد الإلكتروني', value: email, set: setEmail, type: 'email', placeholder: 'admin@dostoori.jo' }, { label: 'كلمة المرور', value: password, set: setPassword, type: 'password', placeholder: '••••••••' }].map((f) => (
            <div key={f.label} style={{ marginBottom: 14 }}>
              <label style={S.label}>{f.label}</label>
              <input type={f.type} value={f.value} onChange={(e) => f.set(e.target.value)} placeholder={f.placeholder} onKeyDown={(e) => e.key === 'Enter' && login()} style={{ ...S.inp, borderColor: 'rgba(255,255,255,.07)' }} />
            </div>
          ))}
          {loginError && <div style={{ color: '#F87171', fontSize: '.8rem', textAlign: 'center', marginBottom: 10 }}>{loginError}</div>}
          <button onClick={login} disabled={loginBusy} style={{ width: '100%', background: 'linear-gradient(135deg,#EF4444,#DC2626)', border: 'none', borderRadius: 10, padding: 13, color: '#fff', fontFamily: "'Cairo',sans-serif", fontSize: '1rem', fontWeight: 800, cursor: loginBusy ? 'wait' : 'pointer', marginTop: 6, opacity: loginBusy ? .8 : 1 }}>
            {loginBusy ? 'جارٍ التحقق...' : 'دخول إلى لوحة الإدارة'}
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
    { id: 'subs',     icon: '👥', label: 'المشتركون', group: 'العملاء', badge: '23' },
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
                <div><h1 style={{ fontSize: '1.25rem', fontWeight: 900, color: '#F1F5F9' }}>📊 لوحة التحكم</h1><p style={{ fontSize: '.8rem', color: '#64748B', marginTop: 3 }}>آخر تحديث: اليوم 10:42 ص</p></div>
                <button onClick={() => location.reload()} style={S.btnGold}>↻ تحديث</button>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 14, marginBottom: 22 }}>
                {[{ n: '23', l: 'مكتب مشترك', c: '#10B981' }, { n: '7', l: 'تجربة مجانية نشطة', c: '#D4AF37' }, { n: '1,840', l: 'دينار / هذا الشهر', c: '#60A5FA' }, { n: '2', l: 'اشتراك متأخر', c: '#EF4444' }].map((s) => (
                  <div key={s.l} style={{ ...S.card, textAlign: 'center' }}>
                    <div style={{ fontSize: '1.8rem', fontWeight: 900, marginBottom: 4, color: s.c }}>{s.n}</div>
                    <div style={{ fontSize: '.75rem', color: '#64748B' }}>{s.l}</div>
                  </div>
                ))}
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                <div style={S.card}>
                  <div style={{ fontSize: '.78rem', fontWeight: 800, color: '#64748B', letterSpacing: '.5px', textTransform: 'uppercase', marginBottom: 14 }}>📈 نمو الاشتراكات</div>
                  {[{ m: 'يناير', w: '35%', n: '8', c: '#D4AF37' }, { m: 'فبراير', w: '52%', n: '12', c: '#D4AF37' }, { m: 'مارس', w: '65%', n: '15', c: '#D4AF37' }, { m: 'أبريل', w: '78%', n: '18', c: '#10B981' }, { m: 'يوليو', w: '100%', n: '23', c: '#10B981' }].map((row) => (
                    <div key={row.m} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '.8rem', marginBottom: 8 }}>
                      <span style={{ color: row.c, fontWeight: 700 }}>{row.n}</span>
                      <div style={{ flex: 1, margin: '0 12px', background: '#1F2937', borderRadius: 3, height: 8, overflow: 'hidden' }}>
                        <div style={{ width: row.w, height: '100%', background: `linear-gradient(90deg,${row.c},${row.c})`, borderRadius: 3 }} />
                      </div>
                      <span>{row.m}</span>
                    </div>
                  ))}
                </div>
                <div style={S.card}>
                  <div style={{ fontSize: '.78rem', fontWeight: 800, color: '#64748B', letterSpacing: '.5px', textTransform: 'uppercase', marginBottom: 14 }}>🔔 آخر الأنشطة</div>
                  {[
                    { type: '#10B981', label: '✓ اشتراك جديد', sub: 'مكتب عمر النابلسي — احترافي', time: 'منذ ساعتين' },
                    { type: '#F59E0B', label: '⚠ تجديد متأخر', sub: 'مكتب القرعان للمحاماة', time: 'منذ 3 أيام' },
                    { type: '#60A5FA', label: '📝 طلب تجربة مجانية', sub: 'مكتب أبو الهيجاء — عمّان', time: 'منذ 5 ساعات' },
                    { type: '#EF4444', label: '✕ إلغاء اشتراك', sub: 'مكتب شيخ — أربد', time: 'أمس' },
                  ].map((a, i) => (
                    <div key={i} style={{ fontSize: '.8rem', padding: 8, borderRadius: 7, borderRight: `3px solid ${a.type}`, background: `${a.type}0d`, marginBottom: 9 }}>
                      <span style={{ color: a.type, fontWeight: 700 }}>{a.label}</span><br />
                      <span style={{ color: '#94A3B8' }}>{a.sub}</span><br />
                      <span style={{ color: '#374151', fontSize: '.71rem' }}>{a.time}</span>
                    </div>
                  ))}
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
          {page === 'subs' && (
            <div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
                <div><h1 style={{ fontSize: '1.25rem', fontWeight: 900, color: '#F1F5F9' }}>👥 المشتركون</h1><p style={{ fontSize: '.8rem', color: '#64748B', marginTop: 3 }}>23 مكتب نشط</p></div>
                <button style={S.btnGold}>+ إضافة</button>
              </div>
              <div style={S.card}>
                <div style={{ display: 'flex', gap: 10, marginBottom: 16 }}>
                  <input placeholder="🔍 بحث..." style={{ ...S.inp, flex: 1, maxWidth: 320 }} />
                  <select style={{ ...S.inp, maxWidth: 160 }}><option>كل الباقات</option><option>أساسي</option><option>احترافي</option><option>مؤسسي</option></select>
                  <select style={{ ...S.inp, maxWidth: 160 }}><option>كل الحالات</option><option>نشط</option><option>متأخر</option></select>
                </div>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '.82rem' }}>
                  <thead>
                    <tr>
                      {['#','المكتب','المحامي المسؤول','المدينة','الباقة','الاشتراك','التجديد','الحالة',''].map((h) => (
                        <th key={h} style={{ textAlign: 'right', padding: '9px 12px', color: '#64748B', fontWeight: 700, fontSize: '.75rem', borderBottom: '1px solid rgba(255,255,255,.06)' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {[
                      { id: 1, firm: 'مكتب الشوبكي للمحاماة', lawyer: 'خالد الشوبكي', city: 'عمّان', pkg: <Bx type="g" label="مؤسسي" />, fee: '80 د.أ', renew: '01/09/2026', status: <Bx type="g" label="● نشط" /> },
                      { id: 2, firm: 'مكتب النابلسي القانوني', lawyer: 'عمر النابلسي', city: 'عمّان', pkg: <Bx type="b" label="احترافي" />, fee: '50 د.أ', renew: '25/08/2026', status: <Bx type="g" label="● نشط" /> },
                      { id: 3, firm: 'القرعان للمحاماة', lawyer: 'فيصل القرعان', city: 'إربد', pkg: <Bx type="b" label="احترافي" />, fee: '50 د.أ', renew: '15/07/2026', status: <Bx type="r" label="● متأخر" /> },
                      { id: 4, firm: 'مكتب الزيود القانوني', lawyer: 'أحمد الزيود', city: 'الزرقاء', pkg: <Bx type="g" label="أساسي" />, fee: '25 د.أ', renew: '10/08/2026', status: <Bx type="g" label="● نشط" /> },
                    ].map((row) => (
                      <tr key={row.id} style={{ borderBottom: '1px solid rgba(255,255,255,.04)' }}>
                        <td style={{ padding: '10px 12px', color: '#CBD5E1' }}>{row.id}</td>
                        <td style={{ padding: '10px 12px', color: '#E2E8F0', fontWeight: 700 }}>{row.firm}</td>
                        <td style={{ padding: '10px 12px', color: '#CBD5E1' }}>{row.lawyer}</td>
                        <td style={{ padding: '10px 12px', color: '#CBD5E1' }}>{row.city}</td>
                        <td style={{ padding: '10px 12px' }}>{row.pkg}</td>
                        <td style={{ padding: '10px 12px', color: '#CBD5E1' }}>{row.fee}</td>
                        <td style={{ padding: '10px 12px', color: '#CBD5E1' }}>{row.renew}</td>
                        <td style={{ padding: '10px 12px' }}>{row.status}</td>
                        <td style={{ padding: '10px 12px' }}><button style={S.btnGhost}>تفاصيل</button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Trials */}
          {page === 'trials' && (
            <div>
              <div style={{ marginBottom: 24 }}><h1 style={{ fontSize: '1.25rem', fontWeight: 900, color: '#F1F5F9' }}>🕐 التجارب المجانية</h1><p style={{ fontSize: '.8rem', color: '#64748B', marginTop: 3 }}>7 طلبات نشطة</p></div>
              <div style={S.card}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '.82rem' }}>
                  <thead>
                    <tr>
                      {['المكتب','المحامي','الهاتف','المدينة','تاريخ الطلب','ينتهي','الحالة',''].map((h) => (
                        <th key={h} style={{ textAlign: 'right', padding: '9px 12px', color: '#64748B', fontWeight: 700, fontSize: '.75rem', borderBottom: '1px solid rgba(255,255,255,.06)' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {[
                      { firm: 'مكتب أبو الهيجاء', lawyer: 'نضال أبو الهيجاء', phone: '0791234567', city: 'عمّان', from: '23/07/2026', to: '22/08/2026', status: <Bx type="y" label="جديد" /> },
                      { firm: 'مكتب الرواشدة', lawyer: 'عيسى الرواشدة', phone: '0799876543', city: 'إربد', from: '20/07/2026', to: '19/08/2026', status: <Bx type="b" label="نشط" /> },
                      { firm: 'مكتب عبيدات القانوني', lawyer: 'مازن عبيدات', phone: '0795551234', city: 'السلط', from: '18/07/2026', to: '17/08/2026', status: <Bx type="b" label="نشط" /> },
                    ].map((row, i) => (
                      <tr key={i} style={{ borderBottom: '1px solid rgba(255,255,255,.04)' }}>
                        {[row.firm, row.lawyer, row.phone, row.city, row.from, row.to].map((cell, j) => (
                          <td key={j} style={{ padding: '10px 12px', color: j === 0 ? '#E2E8F0' : '#CBD5E1', fontWeight: j === 0 ? 700 : 400 }}>{cell}</td>
                        ))}
                        <td style={{ padding: '10px 12px' }}>{row.status}</td>
                        <td style={{ padding: '10px 12px' }}><button style={S.btnGhost}>تفاصيل</button></td>
                      </tr>
                    ))}
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
                    <div style={{ fontSize: '.78rem', fontWeight: 800, color: '#64748B', letterSpacing: '.5px', textTransform: 'uppercase', marginBottom: 14 }}>👤 بيانات حساب الادمن</div>
                    {[
                      { label: 'الاسم', val: 'Admin — Dostoori', type: 'text' },
                      { label: 'البريد الإلكتروني', val: 'admin@dostoori.jo', type: 'email' },
                      { label: 'كلمة مرور جديدة', val: '', type: 'password', placeholder: 'اتركه فارغاً للإبقاء على الحالية' },
                    ].map((f) => (
                      <div key={f.label} style={{ marginBottom: 12 }}>
                        <label style={S.label}>{f.label}</label>
                        <input type={f.type} defaultValue={f.val} placeholder={f.placeholder} style={S.inp} />
                      </div>
                    ))}
                    <button style={S.btnRed} onClick={() => setToast('✓ تم حفظ بيانات الحساب')}>💾 حفظ</button>
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
