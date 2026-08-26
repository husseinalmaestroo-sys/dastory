'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import './dashboard.css'
import { fmtDate, fmtMoney, statusAr } from '@/lib/api'

type PageId =
  | 'dash'
  | 'clients'
  | 'cases'
  | 'sessions'
  | 'invoices'
  | 'team'
  | 'timelog'
  | 'calendar'
  | 'ai-contract'
  | 'ai-write'
  | 'ai-assistant'
  | 'ai-case'
  | 'docs'
  | 'file-search'
  | 'ocr'
  | 'doc-compare'
  | 'doc-gen'
  | 'esign'
  | 'legal-search'
  | 'office-search'
  | 'reports'
  | 'email'
  | 'notifications'
  | 'moj'
  | 'settings'
  | 'backup'

type ModalId =
  | 'm-add-case'
  | 'm-add-client'
  | 'm-add-session'
  | 'm-add-invoice'
  | 'm-edit-session'
  | 'm-edit-invoice'
  | 'm-compose'
  | 'm-client-detail'
  | 'm-case-detail'
  | 'm-moj-guide'

type ChatMessage = {
  role: 'u' | 'a'
  text: string
  citation?: string
}

type TimeEntry = {
  id: string
  date: string
  task: string
  minutes: number
  billable: boolean
  invoiced: boolean
  case: { number: string; title: string } | null
}

type NavItem = { id: PageId; icon: string; label: string; badge?: string }
type NavSection = { label: string; items: NavItem[] }

const BASE_NAV: NavSection[] = [
  { label: 'الرئيسية', items: [{ id: 'dash', icon: '🏠', label: 'لوحة التحكم' }] },
  {
    label: 'إدارة المكتب',
    items: [
      { id: 'clients',  icon: '👥', label: 'إدارة العملاء' },
      { id: 'cases',    icon: '⚖️', label: 'إدارة القضايا' },
      { id: 'sessions', icon: '📅', label: 'إدارة الجلسات' },
      { id: 'invoices', icon: '💳', label: 'الفواتير' },
      { id: 'calendar', icon: '🗓️', label: 'التقويم الشامل' },
      { id: 'timelog',  icon: '⏱️', label: 'تتبع الوقت' },
    ],
  },
  {
    label: 'الذكاء الاصطناعي',
    items: [
      { id: 'ai-contract',  icon: '📄', label: 'مراجعة العقود AI' },
      { id: 'ai-write',     icon: '✍️', label: 'كتابة العقود AI' },
      { id: 'ai-assistant', icon: '🤖', label: 'المساعد القانوني' },
      { id: 'ai-case',      icon: '🧠', label: 'تحليل القضايا AI' },
    ],
  },
  {
    label: 'المستندات',
    items: [
      { id: 'docs',        icon: '🗂️', label: 'إدارة الملفات' },
      { id: 'file-search', icon: '🔍', label: 'بحث الملفات' },
      { id: 'ocr',         icon: '📷', label: 'OCR — تحويل صورة' },
      { id: 'doc-compare', icon: '🔀', label: 'مقارنة مستندين' },
      { id: 'doc-gen',     icon: '📝', label: 'إنشاء مستندات' },
      { id: 'esign',       icon: '🖊️', label: 'التوقيع الإلكتروني' },
    ],
  },
  {
    label: 'البحث',
    items: [
      { id: 'legal-search',   icon: '📚', label: 'البحث القانوني' },
      { id: 'office-search',  icon: '🏢', label: 'محرك بحث المكتب' },
    ],
  },
  {
    label: 'التواصل',
    items: [
      { id: 'email',         icon: '📧', label: 'البريد الإلكتروني' },
      { id: 'notifications', icon: '🔔', label: 'الإشعارات' },
      { id: 'moj',           icon: '🏛️', label: 'بوابة العدل' },
      { id: 'settings',      icon: '🔐', label: 'الأمان والإعدادات' },
    ],
  },
]

const ADMIN_NAV: NavSection = {
  label: 'إدارة المكتب — مدير',
  items: [
    { id: 'team',     icon: '👤', label: 'إدارة الفريق' },
    { id: 'reports',  icon: '📊', label: 'التقارير' },
    { id: 'backup',   icon: '💾', label: 'النسخ الاحتياطي' },
  ],
}

const titles: Record<PageId, string> = {
  dash: 'لوحة التحكم',
  clients: 'إدارة العملاء',
  cases: 'إدارة القضايا',
  sessions: 'إدارة الجلسات',
  invoices: 'الفواتير',
  team: 'إدارة الفريق',
  timelog: 'تتبع الوقت',
  calendar: 'التقويم الشامل',
  'ai-contract': 'مراجعة العقود AI',
  'ai-write': 'كتابة العقود AI',
  'ai-assistant': 'المساعد القانوني',
  'ai-case': 'تحليل القضايا AI',
  docs: 'إدارة الملفات',
  'file-search': 'بحث الملفات',
  ocr: 'OCR — تحويل صورة',
  'doc-compare': 'مقارنة مستندين',
  'doc-gen': 'إنشاء مستندات',
  esign: 'التوقيع الإلكتروني',
  'legal-search': 'البحث القانوني',
  'office-search': 'بحث المكتب',
  reports: 'التقارير',
  email: 'البريد الإلكتروني',
  notifications: 'الإشعارات',
  moj: 'بوابة وزارة العدل',
  settings: 'الأمان والإعدادات',
  backup: 'النسخ الاحتياطي',
}

function Badge({ type = 'ac', children }: { type?: 'ac' | 'pe' | 'cl' | 'ur' | 'go' | 'bl' | 'pu'; children: React.ReactNode }) {
  return <span className={`bx ${type}`}>{children}</span>
}

function Field({ label, children, full = false }: { label: string; children: React.ReactNode; full?: boolean }) {
  return (
    <div className={`ff${full ? ' full' : ''}`}>
      <label>{label}</label>
      {children}
    </div>
  )
}

function SectionHeader({
  title,
  subtitle,
  children,
}: {
  title: string
  subtitle?: string
  children?: React.ReactNode
}) {
  return (
    <div className="ph">
      <div>
        <h1>{title}</h1>
        {subtitle && <p>{subtitle}</p>}
      </div>
      {children}
    </div>
  )
}

function PlaceholderPage({ title }: { title: string }) {
  return (
    <div className="pg">
      <SectionHeader title={title} subtitle="سيتم استبدال هذه البطاقة بمحتوى الصفحة في المرحلة التالية." />
      <div className="card">
        <div className="ct">قيد البناء</div>
        <p style={{ color: '#94A3B8', fontSize: '.84rem', lineHeight: 1.8 }}>
          الهيكل والتنقل جاهزان. سأضيف محتوى هذه الصفحة والوظائف الخاصة بها ضمن الدفعات التالية.
        </p>
      </div>
    </div>
  )
}

function StatCard({ icon, value, label, change, down = false }: { icon: string; value: string; label: string; change?: string; down?: boolean }) {
  return (
    <div className="sc">
      <div className="sic">{icon}</div>
      <div className="sv">{value}</div>
      <div className="sl">{label}</div>
      {change && <div className={`sch ${down ? 'dn' : 'up'}`}>{change}</div>}
    </div>
  )
}

type DashStats = {
  totalClients: number
  totalCases: number
  activeCases: number
  upcomingSessions: number
  revenue: number
  unpaid: number
  totalRevenue: number
}
type RecentCase = { id: string; number: string; title: string; court: string; status: string; client: { name: string } }
type UpcomingSession = { id: string; date: string; time: string; court: string; case: { number: string; title: string } }

function DashboardHome({ openModal, switchPage, authUser }: {
  openModal: OpenModal
  switchPage: (id: PageId) => void
  authUser: AuthUser | null
}) {
  const [stats, setStats] = useState<DashStats | null>(null)
  const [recentCases, setRecentCases] = useState<RecentCase[]>([])
  const [todaySessions, setTodaySessions] = useState<UpcomingSession[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/dashboard')
      .then(r => r.json())
      .then(d => {
        if (d.stats) {
          setStats(d.stats)
          setRecentCases(d.recentCases ?? [])
          setTodaySessions(d.todaySessions ?? [])
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  const statusBadgeType = (s: string): 'ac' | 'pe' | 'cl' | 'ur' => {
    if (s === 'ACTIVE') return 'ac'
    if (s === 'CLOSED') return 'cl'
    if (s === 'SUSPENDED') return 'pe'
    return 'ur'
  }

  return (
    <div className="pg">
      <SectionHeader title="لوحة التحكم" subtitle={`مرحباً ${authUser?.name?.split(' ')[0] ?? ''}، إليك ملخص اليوم`}>
        <button className="dbtn dbtn-s">📤 تصدير تقرير</button>
      </SectionHeader>

      <div className="sg">
        <StatCard icon="⚖️" value={loading ? '...' : String(stats?.activeCases ?? 0)} label="القضايا المفتوحة" change={stats ? `${stats.totalCases} إجمالي` : undefined} />
        <StatCard icon="📅" value={loading ? '...' : String(stats?.upcomingSessions ?? 0)} label="جلسات قادمة" change={stats ? `${stats.totalClients} عميل` : undefined} />
        <StatCard icon="💳" value={loading ? '...' : fmtMoney(stats?.revenue ?? 0)} label="الإيرادات المحصلة" change={stats ? `${fmtMoney(stats.unpaid)} غير محصل` : undefined} down={!!stats && stats.unpaid > 0} />
        <StatCard icon="💰" value={loading ? '...' : fmtMoney(stats?.totalRevenue ?? 0)} label="إجمالي الفواتير" />
      </div>

      <div className="g2" style={{ marginBottom: 14 }}>
        <div className="card">
          <div className="ct">⚖️ القضايا الأخيرة</div>
          <table className="dt">
            <tbody>
              <tr>
                <th>القضية</th>
                <th>الموكل</th>
                <th>المحكمة</th>
                <th>الحالة</th>
              </tr>
              {loading ? (
                <tr><td colSpan={4} style={{ textAlign: 'center', color: '#64748B', padding: 20 }}>جاري التحميل...</td></tr>
              ) : recentCases.length === 0 ? (
                <tr><td colSpan={4} style={{ textAlign: 'center', color: '#64748B', padding: 20 }}>لا توجد قضايا</td></tr>
              ) : recentCases.map(c => (
                <tr key={c.id}>
                  <td>{c.number} — {c.title}</td>
                  <td>{c.client.name}</td>
                  <td>{c.court || '—'}</td>
                  <td><Badge type={statusBadgeType(c.status)}>● {statusAr[c.status] ?? c.status}</Badge></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div className="card">
            <div className="ct">📅 الجلسات القادمة</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {loading ? (
                <div style={{ color: '#64748B', fontSize: '.82rem', textAlign: 'center', padding: 16 }}>جاري التحميل...</div>
              ) : todaySessions.length === 0 ? (
                <div style={{ color: '#64748B', fontSize: '.82rem', textAlign: 'center', padding: 16 }}>لا توجد جلسات قادمة</div>
              ) : todaySessions.map((s, i) => (
                <div key={s.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: 9, background: i === 0 ? 'rgba(212,175,55,.07)' : 'rgba(255,255,255,.03)', borderRadius: 9, border: `1px solid ${i === 0 ? 'rgba(212,175,55,.15)' : 'transparent'}` }}>
                  <div>
                    <div style={{ fontSize: '.82rem', fontWeight: 700, color: '#E2E8F0' }}>{s.case.number} — {s.case.title}</div>
                    <div style={{ fontSize: '.72rem', color: '#94A3B8', marginTop: 2 }}>{s.court}</div>
                  </div>
                  <div style={{ textAlign: 'left' }}>
                    <div style={{ fontSize: '.78rem', color: i === 0 ? 'var(--gold, #D4AF37)' : '#60A5FA', fontWeight: 700 }}>{fmtDate(s.date)}</div>
                    <div style={{ fontSize: '.7rem', color: '#64748B' }}>{s.time}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="card">
            <div className="ct">🔔 إشعارات ذكية</div>
            <Notification icon="⚠️" color="#EF4444" title="عقد شركة الأمانة ينتهي بعد 7 أيام" subtitle="مراجعة وتجديد فوري" time="الآن" />
            <Notification icon="📅" color="#F59E0B" title="جلسة غداً — قضية 2024/1701" subtitle="تأكد من الأوراق والتحضير" time="منذ ساعة" />
            <Notification icon="💳" color="#10B981" title="دفعة مستحقة — أحمد المصري" subtitle="850 د.أ · تاريخ الاستحقاق: الأحد" time="3 ساعات" />
          </div>
        </div>
      </div>

      <div className="card">
        <div className="ct">⚡ إجراءات سريعة</div>
        <div className="qg">
          <QuickAction icon="⚖️" label="قضية جديدة" onClick={() => openModal('m-add-case')} />
          <QuickAction icon="👤" label="عميل جديد" onClick={() => openModal('m-add-client')} />
          <QuickAction icon="📄" label="راجع عقداً" onClick={() => switchPage('ai-contract')} />
          <QuickAction icon="🤖" label="اسأل المساعد" onClick={() => switchPage('ai-assistant')} />
          <QuickAction icon="📅" label="موعد جلسة" onClick={() => openModal('m-add-session')} />
          <QuickAction icon="📚" label="بحث قانوني" onClick={() => switchPage('legal-search')} />
          <QuickAction icon="🧾" label="فاتورة جديدة" onClick={() => openModal('m-add-invoice')} />
          <QuickAction icon="📝" label="أنشئ مستنداً" onClick={() => switchPage('doc-gen')} />
        </div>
      </div>
    </div>
  )
}

function QuickAction({ icon, label, onClick }: { icon: string; label: string; onClick: () => void }) {
  return (
    <button className="qb" onClick={onClick}>
      <div className="qbi">{icon}</div>
      <div className="qbl">{label}</div>
    </button>
  )
}

function Notification({ icon, color, title, subtitle, time }: { icon: string; color: string; title: string; subtitle: string; time: string }) {
  return (
    <div className="nit">
      <div className="nii" style={{ background: `${color}1F`, color }}>{icon}</div>
      <div className="nib">
        <div className="nt">{title}</div>
        <div className="ns">{subtitle}</div>
      </div>
      <div className="ntm">{time}</div>
    </div>
  )
}

function ClientsPage({ openModal, refreshKey }: { openModal: OpenModal; refreshKey: number }) {
  const [clients, setClients] = useState<any[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')

  useEffect(() => {
    setLoading(true)
    const q = search.trim()
    const timer = window.setTimeout(() => {
      fetch(`/api/clients${q ? `?q=${encodeURIComponent(q)}` : ''}`)
        .then(r => { setTotal(Number(r.headers.get('X-Total-Count') ?? '0')); return r.json() })
        .then(d => { if (Array.isArray(d)) setClients(d) })
        .catch(() => {})
        .finally(() => setLoading(false))
    }, q ? 300 : 0)
    return () => window.clearTimeout(timer)
  }, [refreshKey, search])

  return (
    <div className="pg">
      <SectionHeader title="إدارة العملاء" subtitle={`${total} عميل`}>
        <button className="dbtn dbtn-p" onClick={() => openModal('m-add-client')}>+ عميل جديد</button>
      </SectionHeader>
      <div className="sb2"><div className="si">🔍</div><input placeholder="ابحث باسم العميل أو رقم الهاتف..." value={search} onChange={e => setSearch(e.target.value)} /></div>
      {!search && total > clients.length && (
        <div style={{ color: '#F59E0B', fontSize: '.78rem', marginBottom: 10 }}>⚠️ تُعرض أحدث {clients.length} من أصل {total} — استخدم البحث لتضييق النتائج</div>
      )}
      <div className="card" style={{ marginBottom: 14 }}>
        {loading ? <div style={{ padding: 32, textAlign: 'center', color: '#94A3B8' }}>جارٍ التحميل...</div> : (
          <table className="dt">
            <tbody>
              <tr><th>اسم العميل</th><th>الهاتف</th><th>البريد</th><th>القضايا</th><th>الفواتير</th><th /></tr>
              {clients.map((c) => (
                <tr key={c.id}>
                  <td><b>{c.name}</b></td>
                  <td>{c.phone ?? '—'}</td>
                  <td>{c.email ?? '—'}</td>
                  <td><Badge type="bl">{c._count.cases} قضية</Badge></td>
                  <td><Badge type="go">{c._count.invoices} فاتورة</Badge></td>
                  <td><button className="dbtn dbtn-s" style={{ padding: '4px 10px', fontSize: '.72rem' }} onClick={() => openModal('m-client-detail', { clientId: c.id })}>عرض</button></td>
                </tr>
              ))}
              {!loading && clients.length === 0 && <tr><td colSpan={6} style={{ textAlign: 'center', color: '#94A3B8', padding: 24 }}>لا توجد نتائج</td></tr>}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}

const CASE_STATUS_AR: Record<string, string> = { ACTIVE: 'نشطة', CLOSED: 'مغلقة', SUSPENDED: 'معلقة', PENDING: 'قيد الانتظار' }
const CASE_STATUS_BADGE: Record<string, 'ac' | 'cl' | 'pe' | 'ur'> = { ACTIVE: 'ac', CLOSED: 'cl', SUSPENDED: 'pe', PENDING: 'ur' }

function CasesPage({ openModal, refreshKey }: { openModal: OpenModal; refreshKey: number }) {
  const [cases, setCases] = useState<any[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('ALL')

  useEffect(() => {
    setLoading(true)
    fetch('/api/cases')
      .then(r => { setTotal(Number(r.headers.get('X-Total-Count') ?? '0')); return r.json() })
      .then(d => { if (Array.isArray(d)) setCases(d) })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [refreshKey])

  const filtered = filter === 'ALL' ? cases : cases.filter(c => c.status === filter)

  return (
    <div className="pg">
      <SectionHeader title="إدارة القضايا" subtitle={`${cases.filter(c => c.status === 'ACTIVE').length} قضية نشطة`}>
        <button className="dbtn dbtn-p" onClick={() => openModal('m-add-case')}>+ قضية جديدة</button>
      </SectionHeader>
      <div style={{ display: 'flex', gap: 9, marginBottom: 16, flexWrap: 'wrap' }}>
        {['ALL', 'ACTIVE', 'SUSPENDED', 'CLOSED', 'PENDING'].map(s => (
          <button key={s} onClick={() => setFilter(s)} className="dbtn" style={{ background: filter === s ? 'var(--gold)' : 'rgba(255,255,255,.06)', color: filter === s ? '#0F172A' : '#94A3B8', border: 'none', padding: '5px 14px', borderRadius: 20, fontSize: '.78rem', fontWeight: 700, cursor: 'pointer' }}>
            {s === 'ALL' ? `الكل (${cases.length})` : `${CASE_STATUS_AR[s]} (${cases.filter(c => c.status === s).length})`}
          </button>
        ))}
      </div>
      {total > cases.length && (
        <div style={{ color: '#F59E0B', fontSize: '.78rem', marginBottom: 10 }}>⚠️ تُعرض أحدث {cases.length} من أصل {total} قضية</div>
      )}
      <div className="card">
        {loading ? <div style={{ padding: 32, textAlign: 'center', color: '#94A3B8' }}>جارٍ التحميل...</div> : (
          <table className="dt">
            <tbody>
              <tr><th>رقم القضية</th><th>العنوان</th><th>النوع</th><th>الموكل</th><th>المحكمة</th><th>المحامي</th><th>الجلسات</th><th>الحالة</th><th /></tr>
              {filtered.map((c) => (
                <tr key={c.id}>
                  <td><b>{c.number}</b></td>
                  <td>{c.title}</td>
                  <td>{c.type}</td>
                  <td>{c.client.name}</td>
                  <td>{c.court ?? '—'}</td>
                  <td>{c.lawyer?.name ?? '—'}</td>
                  <td><Badge type="bl">{c._count.sessions}</Badge></td>
                  <td><Badge type={CASE_STATUS_BADGE[c.status]}>{CASE_STATUS_AR[c.status]}</Badge></td>
                  <td><button className="dbtn dbtn-s" style={{ padding: '4px 9px', fontSize: '.7rem' }} onClick={() => openModal('m-case-detail', { caseId: c.id })}>تفاصيل</button></td>
                </tr>
              ))}
              {filtered.length === 0 && <tr><td colSpan={9} style={{ textAlign: 'center', color: '#94A3B8', padding: 24 }}>لا توجد قضايا</td></tr>}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}

const SES_STATUS_AR: Record<string, string> = { UPCOMING: 'قادمة', DONE: 'منتهية', POSTPONED: 'مؤجلة' }
const SES_STATUS_BADGE: Record<string, 'ac' | 'cl' | 'pe'> = { UPCOMING: 'ac', DONE: 'cl', POSTPONED: 'pe' }

function SessionsPage({ openModal, refreshKey }: { openModal: OpenModal; refreshKey: number }) {
  const [sessions, setSessions] = useState<any[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    fetch('/api/sessions').then(r => r.json()).then(d => { if (Array.isArray(d)) setSessions(d) }).catch(() => {}).finally(() => setLoading(false))
  }, [refreshKey])

  const upcoming = sessions.filter(s => s.status === 'UPCOMING')

  return (
    <div className="pg">
      <SectionHeader title="إدارة الجلسات" subtitle={`${upcoming.length} جلسة قادمة`}>
        <button className="dbtn dbtn-p" onClick={() => openModal('m-add-session')}>+ جلسة جديدة</button>
      </SectionHeader>
      {loading ? <div style={{ padding: 32, textAlign: 'center', color: '#94A3B8' }}>جارٍ التحميل...</div> : (
        <div className="card">
          <div className="ct">📋 الجلسات</div>
          <table className="dt">
            <tbody>
              <tr><th>التاريخ</th><th>الوقت</th><th>القضية</th><th>الموكل</th><th>المحكمة</th><th>القاضي</th><th>الحالة</th><th /></tr>
              {sessions.map((s) => (
                <tr key={s.id}>
                  <td><b>{new Date(s.date).toLocaleDateString('ar-JO')}</b></td>
                  <td>{s.time}</td>
                  <td>{s.case.number}</td>
                  <td>{s.case.client.name}</td>
                  <td>{s.court}</td>
                  <td>{s.judge ?? '—'}</td>
                  <td><Badge type={SES_STATUS_BADGE[s.status]}>{SES_STATUS_AR[s.status]}</Badge></td>
                  <td><button className="dbtn dbtn-s" style={{ padding: '4px 10px', fontSize: '.72rem' }} onClick={() => openModal('m-edit-session', { sessionId: s.id })}>✏️ تعديل</button></td>
                </tr>
              ))}
              {sessions.length === 0 && <tr><td colSpan={8} style={{ textAlign: 'center', color: '#94A3B8', padding: 24 }}>لا توجد جلسات</td></tr>}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

const INV_STATUS_AR: Record<string, string> = { PAID: 'مدفوعة', UNPAID: 'غير مدفوعة', PARTIAL: 'جزئي', OVERDUE: 'متأخرة' }
const INV_STATUS_BADGE: Record<string, 'ac' | 'cl' | 'pe' | 'ur'> = { PAID: 'ac', UNPAID: 'cl', PARTIAL: 'pe', OVERDUE: 'ur' }

function InvoicesPage({ openModal, refreshKey }: { openModal: OpenModal; refreshKey: number }) {
  const [invoices, setInvoices] = useState<any[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    fetch('/api/invoices').then(r => r.json()).then(d => { if (Array.isArray(d)) setInvoices(d) }).catch(() => {}).finally(() => setLoading(false))
  }, [refreshKey])

  const totalAmount = invoices.reduce((s, i) => s + i.amount, 0)
  const totalPaid = invoices.reduce((s, i) => s + i.paid, 0)
  const totalUnpaid = totalAmount - totalPaid
  const countPaid = invoices.filter(i => i.status === 'PAID').length

  return (
    <div className="pg">
      <SectionHeader title="الفواتير" subtitle={`إجمالي مستحق: ${totalUnpaid.toLocaleString('ar-JO')} د.أ`}>
        <button className="dbtn dbtn-p" onClick={() => openModal('m-add-invoice')}>+ فاتورة جديدة</button>
      </SectionHeader>
      <div className="sg">
        <StatCard icon="💰" value={totalPaid.toLocaleString('ar-JO')} label="إجمالي المحصّل (د.أ)" />
        <StatCard icon="⏳" value={totalUnpaid.toLocaleString('ar-JO')} label="مستحقات غير مدفوعة" />
        <StatCard icon="✅" value={String(countPaid)} label="فواتير مدفوعة" />
        <StatCard icon="📋" value={String(invoices.length)} label="إجمالي الفواتير" />
      </div>
      <div className="card">
        <div className="ct">🧾 الفواتير</div>
        {loading ? <div style={{ padding: 24, textAlign: 'center', color: '#94A3B8' }}>جارٍ التحميل...</div> : (
          <table className="dt">
            <tbody>
              <tr><th>رقم الفاتورة</th><th>العميل</th><th>القضية</th><th>المبلغ</th><th>المدفوع</th><th>الاستحقاق</th><th>الحالة</th><th /></tr>
              {invoices.map((inv) => (
                <tr key={inv.id}>
                  <td><b>{inv.number}</b></td>
                  <td>{inv.client.name}</td>
                  <td>{inv.case?.number ?? '—'}</td>
                  <td>{inv.amount.toLocaleString('ar-JO')} د.أ</td>
                  <td>{inv.paid.toLocaleString('ar-JO')} د.أ</td>
                  <td>{inv.dueDate ? new Date(inv.dueDate).toLocaleDateString('ar-JO') : '—'}</td>
                  <td><Badge type={INV_STATUS_BADGE[inv.status]}>{INV_STATUS_AR[inv.status]}</Badge></td>
                  <td><button className="dbtn dbtn-s" style={{ padding: '4px 10px', fontSize: '.72rem' }} onClick={() => openModal('m-edit-invoice', { invoiceId: inv.id })}>✏️ تعديل</button></td>
                </tr>
              ))}
              {invoices.length === 0 && <tr><td colSpan={8} style={{ textAlign: 'center', color: '#94A3B8', padding: 24 }}>لا توجد فواتير</td></tr>}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}

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

function TeamPage() {
  const [team, setTeam] = useState<TeamMember[]>([])
  const [loading, setLoading] = useState(true)
  const [showAdd, setShowAdd] = useState(false)
  const [pwdFor, setPwdFor]   = useState<string | null>(null)
  const [newPwd, setNewPwd]   = useState('')
  const [showNewPwd, setShowNewPwd] = useState(false)
  const [form, setForm] = useState({ name: '', email: '', password: '', confirmPwd: '' })
  const [formErr, setFormErr] = useState('')
  const [formBusy, setFormBusy] = useState(false)
  const [showPwd, setShowPwd] = useState(false)

  useEffect(() => {
    fetch('/api/team').then(r => r.json()).then(d => { if (Array.isArray(d)) setTeam(d) }).catch(() => {}).finally(() => setLoading(false))
  }, [])

  async function toggleActive(id: string, current: boolean) {
    setTeam(t => t.map(m => m.id === id ? { ...m, active: !current } : m))
    await fetch('/api/team', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, active: !current }) }).catch(() => {})
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
                          <button onClick={() => setShowNewPwd(v => !v)} style={{ position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: '#64748B', fontSize: '.8rem', padding: 0 }}>
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

      <PermissionsCard />

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
                  <button onClick={() => setShowPwd(v => !v)} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: '#64748B', fontSize: '.9rem', padding: 0 }}>{showPwd ? '🙈' : '👁'}</button>
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

function PermissionsCard() {
  return (
    <div className="card">
      <div className="ct">🔐 الصلاحيات</div>
      <table className="pt">
        <tbody>
          <tr><th>الصلاحية</th><th>مدير</th><th>محامي</th><th>سكرتير</th><th>محاسب</th></tr>
          {[
            ['إدارة القضايا', true, true, false, false],
            ['إضافة عملاء', true, true, true, false],
            ['الفواتير والمالية', true, false, false, true],
            ['مراجعة العقود AI', true, true, false, false],
            ['إدارة الفريق', true, false, false, false],
            ['النسخ الاحتياطي', true, false, false, false],
            ['التقارير الكاملة', true, false, false, true],
          ].map(([name, admin, lawyer, secretary, accountant]) => (
            <tr key={String(name)}>
              <td>{name}</td>
              {[admin, lawyer, secretary, accountant].map((allowed, index) => (
                <td key={index}><span className={allowed ? 'pck' : 'pxm'}>{allowed ? '✓' : '—'}</span></td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function fmtMinutes(minutes: number) {
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return `${h}:${String(m).padStart(2, '0')}`
}

function TimeLogPage() {
  const [showForm, setShowForm] = useState(false)
  const [running, setRunning] = useState(false)
  const [seconds, setSeconds] = useState(0)
  const [task, setTask] = useState('')
  const [caseId, setCaseId] = useState('')
  const [duration, setDuration] = useState('')
  const [billable, setBillable] = useState(true)
  const [activeTask, setActiveTask] = useState('لا توجد مهمة نشطة')
  const [entries, setEntries] = useState<TimeEntry[]>([])
  const [cases, setCases] = useState<{ id: string; number: string; title: string }[]>([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')

  const load = useCallback(() => {
    fetch('/api/time-entries').then(r => r.json()).then(d => { if (Array.isArray(d)) setEntries(d) }).catch(() => {}).finally(() => setLoading(false))
  }, [])
  useEffect(() => {
    load()
    fetch('/api/cases').then(r => r.json()).then(d => { if (Array.isArray(d)) setCases(d) }).catch(() => {})
  }, [load])

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

  async function saveEntry(minutes: number, taskLabel: string) {
    if (minutes <= 0) return
    try {
      await fetch('/api/time-entries', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ task: taskLabel, minutes, caseId: caseId || null, billable }),
      })
      load()
    } catch { setErr('تعذّر حفظ الوقت') }
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
    await saveEntry(minutes, task.trim())
    setShowForm(false)
    setTask(''); setDuration('')
  }

  async function markInvoiced(id: string) {
    await fetch(`/api/time-entries/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ invoiced: true }) })
    load()
  }

  const totalMinutes = entries.reduce((s, e) => s + e.minutes, 0)
  const billableMinutes = entries.filter(e => e.billable).reduce((s, e) => s + e.minutes, 0)
  const invoicedMinutes = entries.filter(e => e.invoiced).reduce((s, e) => s + e.minutes, 0)
  const conversion = billableMinutes > 0 ? Math.round((invoicedMinutes / billableMinutes) * 100) : 0

  return (
    <div className="pg">
      <SectionHeader title="⏱️ تتبع الوقت" subtitle={loading ? 'جاري التحميل...' : 'سجل الوقت الفعلي'}>
        <button className="dbtn dbtn-p" onClick={() => setShowForm(true)}>+ تسجيل وقت</button>
      </SectionHeader>

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
            {loading ? (
              <tr><td colSpan={7} style={{ textAlign: 'center', color: '#64748B', padding: 20 }}>جارٍ التحميل...</td></tr>
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
      </div>
    </div>
  )
}

const monthNames = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر']

type CalSession = { id: string; date: string; time: string; court: string; status: string; case: { number: string; title: string } }
type CalEvent = { id: string; title: string; date: string; type: string }
type DayMark = { label: string; color: string; sortKey: string }

function CalendarPage() {
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

function CalendarItem({ color, title, subtitle }: { color: string; title: string; subtitle: string }) {
  return (
    <div style={{ padding: 10, borderRight: `3px solid ${color}`, background: 'rgba(255,255,255,.03)', borderRadius: 7, marginBottom: 8 }}>
      <div style={{ fontSize: '.82rem', fontWeight: 700, color: '#E2E8F0' }}>{title}</div>
      <div style={{ fontSize: '.74rem', color: '#64748B' }}>{subtitle}</div>
    </div>
  )
}

function AiContractPage({ switchPage }: { switchPage: (id: PageId) => void }) {
  const [reviewed, setReviewed] = useState(false)
  return (
    <div className="pg">
      <SectionHeader title="مراجعة العقود بالذكاء الاصطناعي" subtitle="ارفع العقد وسيحلله النظام في ثوانٍ" />
      <div className="g2">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div className="card">
            <div className="ct">📤 رفع العقد</div>
            <button className="upl" onClick={() => setReviewed(true)}>
              <div className="uic">📄</div>
              <div className="ut">اسحب العقد هنا أو انقر للاختيار</div>
              <div className="uh">PDF · Word · صور · حتى 50MB</div>
            </button>
            <div style={{ marginTop: 12, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button className="dbtn dbtn-p" onClick={() => setReviewed(true)}>🔍 تحليل العقد</button>
              <button className="dbtn dbtn-s" onClick={() => switchPage('doc-compare')}>🔀 مقارنة مع عقد آخر</button>
            </div>
          </div>
          {reviewed && (
            <div className="card">
              <div className="ct">📋 نتائج التحليل <Badge type="ac">مكتمل</Badge></div>
              <div className="ar">
                {[
                  ['نوع العقد', 'عقد عمل — دوام كامل'],
                  ['الطرف الأول', 'شركة الأمانة للاستثمار'],
                  ['الطرف الثاني', 'محمد سالم العلي'],
                  ['مدة العقد', 'سنة قابلة للتجديد (01/01/2025 - 31/12/2025)'],
                  ['قيمة الراتب', '850 دينار أردني شهرياً'],
                  ['غرامة الإنهاء', '3 أشهر راتب كتعويض'],
                  ['شروط الإنهاء', 'إشعار مسبق 30 يوماً من أي طرف'],
                  ['بند السرية', 'مدة 2 سنة بعد انتهاء العقد'],
                ].map(([label, value]) => (
                  <div className="arr" key={label}><span className="lb">{label}</span><span className="vl">{value}</span></div>
                ))}
              </div>
            </div>
          )}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {reviewed && (
            <div className="card">
              <div className="ct">⚠️ تحليل المخاطر</div>
              <Risk type="dn" title="🔴 بند خطر — تعديل صاحب العمل الأحادي" text="المادة 7: يحق لصاحب العمل تعديل مهام الموظف في أي وقت دون إشعار — مخالف للمادة 26 من قانون العمل الأردني" />
              <Risk type="wn" title="🟡 بند يحتاج مراجعة — ساعات العمل الإضافية" text="لم يُحدَّد مقابل العمل الإضافي بوضوح وفق المادة 57 من قانون العمل" />
              <Risk type="wn" title="🟡 بند ناقص — آلية حل النزاعات" text="لا توجد آلية واضحة لحل النزاعات أو التحكيم" />
              <Risk type="ok" title="🟢 إجازة سنوية — صحيح" text="14 يوم سنوياً متوافق مع المادة 68 من قانون العمل الأردني" />
              <div style={{ marginTop: 10, display: 'flex', gap: 7, flexWrap: 'wrap' }}>
                <button className="dbtn dbtn-p" onClick={() => window.alert('سيتم توليد العقد المُعدَّل كـ Word')}>✏️ اقتراح التعديلات</button>
                <button className="dbtn dbtn-s" onClick={() => window.alert('سيتم إعادة صياغة البند المحدد')}>🔄 إعادة صياغة بند</button>
              </div>
            </div>
          )}
          <div className="card">
            <div className="ct">📝 العقود المحفوظة</div>
            {[
              ['📄 عقد شركة الأمانة.pdf', '3 مخاطر', 'ur'],
              ['📄 عقد إيجار حداد.pdf', 'سليم', 'ac'],
              ['📄 NDA مجموعة النور.docx', '1 تحذير', 'pe'],
            ].map(([name, status, badge]) => (
              <div key={name} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: 8, background: 'rgba(255,255,255,.03)', borderRadius: 8, fontSize: '.8rem', marginBottom: 6 }}>
                <span>{name}</span><Badge type={badge as 'ur' | 'ac' | 'pe'}>{status}</Badge>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

function Risk({ type, title, text }: { type: 'dn' | 'wn' | 'ok'; title: string; text: string }) {
  return (
    <div className={`ri ${type}`}>
      <div>
        <div className="rt">{title}</div>
        <div className="rs">{text}</div>
      </div>
    </div>
  )
}

function AiWritePage() {
  const [selected, setSelected] = useState('عقد عمل')
  const [generated, setGenerated] = useState(false)
  const templates = [
    ['👷', 'عقد عمل'],
    ['🏠', 'عقد إيجار'],
    ['🤝', 'عقد شراكة'],
    ['🛒', 'عقد بيع'],
    ['🔒', 'NDA'],
    ['📋', 'وكالة'],
    ['💼', 'استشارات'],
    ['🔧', 'خدمات'],
  ]
  return (
    <div className="pg">
      <SectionHeader title="كتابة العقود بالذكاء الاصطناعي" subtitle="اختر النوع وسيكتب النظام عقداً مخصصاً" />
      <div className="card" style={{ marginBottom: 14 }}>
        <div className="ct">📂 نوع العقد</div>
        <div className="ctg">
          {templates.map(([icon, label]) => (
            <button key={label} className={`ctc${selected === label ? ' sel' : ''}`} onClick={() => setSelected(label)}>
              <div className="ctci">{icon}</div>
              <div className="ctcl">{label}</div>
            </button>
          ))}
        </div>
      </div>
      <div className="g2">
        <div className="card">
          <div className="ct">📝 بيانات العقد</div>
          <div className="fg">
            <Field label="الطرف الأول"><input className="fi" placeholder="اسم الشركة أو الشخص" /></Field>
            <Field label="الطرف الثاني"><input className="fi" placeholder="اسم الموظف أو المستأجر" /></Field>
            <Field label="تاريخ البداية"><input className="fi" type="date" /></Field>
            <Field label="تاريخ الانتهاء"><input className="fi" type="date" /></Field>
            <Field label="الراتب / القيمة (د.أ)"><input className="fi" placeholder="0.000" /></Field>
            <Field label="المدينة"><select className="fi"><option>عمّان</option><option>إربد</option><option>الزرقاء</option><option>العقبة</option></select></Field>
            <Field label="ملاحظات خاصة" full><textarea className="fi" placeholder="أي شروط إضافية تريد إضافتها..." /></Field>
          </div>
          <div style={{ marginTop: 12, display: 'flex', gap: 8 }}>
            <button className="dbtn dbtn-p" onClick={() => setGenerated(true)}>✨ توليد العقد</button>
            <button className="dbtn dbtn-s">📋 اختر من العملاء</button>
          </div>
        </div>
        <div className="card" style={{ background: 'rgba(255,255,255,.98)', color: '#1E293B' }}>
          <div style={{ textAlign: 'center', marginBottom: 16 }}>
            <div style={{ fontSize: '1rem', fontWeight: 900 }}>{selected}</div>
            <div style={{ fontSize: '.78rem', color: '#64748B', marginTop: 3 }}>مملكة الأردن الهاشمية</div>
          </div>
          <div style={{ fontSize: '.82rem', lineHeight: 1.9, color: '#1E293B' }}>
            {!generated ? (
              <>
                <p style={{ marginBottom: 10 }}>بناءً على أحكام القانون الأردني، تم الاتفاق بين:</p>
                <p><b>الطرف الأول:</b> شركة _____________</p>
                <p><b>الطرف الثاني:</b> السيد/ة _____________</p>
                <p style={{ marginTop: 10, fontWeight: 700 }}>المادة الأولى — موضوع العقد</p>
                <p>سيتم ملء العقد كاملاً بعد إدخال البيانات.</p>
              </>
            ) : (
              <>
                <p><b>الطرف الأول:</b> شركة الأمانة للاستثمار</p>
                <p><b>الطرف الثاني:</b> محمد سالم العلي</p>
                <p style={{ marginTop: 12 }}>اتفق الطرفان على ما يلي وفق أحكام قانون العمل الأردني رقم (8) لسنة 1996 وتعديلاته.</p>
                <p><b>المادة الأولى:</b> المسمى الوظيفي والمهام.</p>
                <p><b>المادة الثانية:</b> الراتب والمكافآت.</p>
                <p><b>المادة الثالثة:</b> ساعات العمل والإجازات.</p>
                <p><b>المادة الرابعة:</b> شروط الإنهاء وتسوية النزاعات.</p>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function AiAssistantPage() {
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      role: 'a',
      text: 'مرحباً المحامي خالد! أنا مساعدك القانوني المدرَّب على التشريعات الأردنية. يمكنني مساعدتك في البحث القانوني، كتابة المذكرات، تلخيص الملفات، والإجابة على أسئلتك القانونية.',
      citation: 'مدعوم بـ RAG على التشريعات الأردنية الكاملة',
    },
  ])

  const answer = (question: string): ChatMessage => {
    const q = question.toLowerCase()
    if (q.includes('فصل') || q.includes('تعسف')) {
      return { role: 'a', text: 'بموجب قانون العمل الأردني، لا يجوز لصاحب العمل فصل العامل بسبب مرضه أو إصابته متى كان ضمن الإجازات القانونية. الفصل في هذه الحالة قد يعد تعسفياً ويستوجب التعويض.', citation: 'قانون العمل الأردني — المواد 32 و77' }
    }
    if (q.includes('تقادم') || q.includes('مدة')) {
      return { role: 'a', text: 'مدة تقادم الدعاوى الشخصية المدنية تكون غالباً 15 سنة، مع وجود مدد خاصة لبعض الحقوق التجارية والعمالية. يلزم تحديد نوع المطالبة قبل اعتماد المدة النهائية.', citation: 'القانون المدني الأردني — قواعد التقادم' }
    }
    if (q.includes('مذكرة') || q.includes('دفاع')) {
      return { role: 'a', text: 'مذكرة دفاع مختصرة:\nإلى السيد رئيس المحكمة المحترم، يتشرف وكيل المدعى عليه بتقديم هذه المذكرة، ملتمساً رد الدعوى لعدم قيامها على أساس صحيح من الواقع والقانون، مع حفظ حق الموكل بتقديم بيناته ودفوعه كافة.', citation: 'نموذج مستند وفق أصول المحاكمات المدنية' }
    }
    return { role: 'a', text: 'وفقاً للتشريعات الأردنية المعمول بها، المسألة تحتاج مراجعة النص الخاص والسوابق القضائية ذات الصلة. أعطني نوع القضية أو النص محل النزاع لأقدّم جواباً أدق.', citation: 'المكتبة القانونية الأردنية الشاملة' }
  }

  const send = (value = input) => {
    const question = value.trim()
    if (!question || busy) return
    setMessages((items) => [...items, { role: 'u', text: question }])
    setInput('')
    setBusy(true)
    window.setTimeout(() => {
      setMessages((items) => [...items, answer(question)])
      setBusy(false)
    }, 700)
  }

  return (
    <div className="pg" style={{ padding: 0 }}>
      <div style={{ padding: '16px 18px 0' }}>
        <SectionHeader title="المساعد القانوني الذكي" subtitle="اسأله أي سؤال قانوني أردني" />
        <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap', marginBottom: 12 }}>
          {['ما الفرق بين الفسخ والإنهاء في عقود العمل؟', 'اكتب مذكرة دفاع في قضية فصل تعسفي', 'ما مدة التقادم في الدعاوى المدنية؟', 'استخرج جميع المخالفات في عقد العمل المرفق'].map((q) => (
            <button key={q} className="dbtn dbtn-s" style={{ fontSize: '.74rem' }} onClick={() => send(q)}>{q.length > 32 ? q.slice(0, 32) : q}</button>
          ))}
        </div>
      </div>
      <div className="cw">
        <div className="cm">
          {messages.map((message, index) => (
            <div key={index} className={`msg ${message.role}`}>
              <span style={{ whiteSpace: 'pre-wrap' }}>{message.text}</span>
              {message.citation && <div className="cit">📚 {message.citation}</div>}
            </div>
          ))}
          {busy && <div className="msg a"><div className="tdots"><span /><span /><span /></div></div>}
        </div>
        <div className="ci-row">
          <input className="ci" value={input} onChange={(e) => setInput(e.target.value)} placeholder="اكتب سؤالك القانوني هنا..." onKeyDown={(e) => e.key === 'Enter' && send()} />
          <button className="dbtn dbtn-p" onClick={() => send()}>إرسال ↵</button>
        </div>
      </div>
    </div>
  )
}

function AiCasePage() {
  const [analyzed, setAnalyzed] = useState(false)
  const [tab, setTab] = useState<'strategy' | 'strength' | 'witnesses' | 'docs'>('strategy')
  return (
    <div className="pg">
      <SectionHeader title="تحليل القضايا بالذكاء الاصطناعي" subtitle="ارفع ملف القضية أو اختر قضية موجودة" />
      <div className="g2">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div className="card">
            <div className="ct">📂 اختر القضية</div>
            <select className="fi" style={{ marginBottom: 12 }}>
              <option>2024/1847 — نزاع عمالي — شركة الأمانة</option>
              <option>2024/2031 — دعوى مدنية — أحمد المصري</option>
              <option>2024/1701 — تجاري — مجموعة النور</option>
            </select>
            <button className="upl" style={{ padding: 20 }} onClick={() => setAnalyzed(true)}><div className="uic">📎</div><div className="ut">أو ارفع ملف القضية</div></button>
            <div style={{ marginTop: 10, display: 'flex', gap: 7, flexWrap: 'wrap' }}>
              <button className="dbtn dbtn-p" onClick={() => setAnalyzed(true)}>🧠 تحليل شامل</button>
              <button className="dbtn dbtn-s" onClick={() => setTab('strategy')}>📋 استراتيجية</button>
              <button className="dbtn dbtn-s" onClick={() => setTab('witnesses')}>👥 أسئلة الشهود</button>
              <button className="dbtn dbtn-s" onClick={() => setTab('docs')}>📅 المستندات</button>
            </div>
          </div>
          {analyzed && (
            <div className="card">
              <div className="ct">📊 ملخص القضية</div>
              <div className="arr"><span className="lb">نوع القضية</span><span className="vl">نزاع عمالي — فصل تعسفي</span></div>
              <div className="arr"><span className="lb">الموكل</span><span className="vl">شركة الأمانة للاستثمار</span></div>
              <div className="arr"><span className="lb">الخصم</span><span className="vl">محمد سالم العلي</span></div>
              <div className="arr"><span className="lb">المطالبة</span><span className="vl">12,000 دينار تعويض + إعادة توظيف</span></div>
              <div className="arr"><span className="lb">احتمال الفوز</span><span className="vl"><Badge type="pe">65% — متوسط</Badge></span></div>
            </div>
          )}
        </div>
        {analyzed && (
          <div className="card">
            <div className="tabs">
              <button className={`tb${tab === 'strategy' ? ' active' : ''}`} onClick={() => setTab('strategy')}>الاستراتيجية</button>
              <button className={`tb${tab === 'strength' ? ' active' : ''}`} onClick={() => setTab('strength')}>نقاط القوة/الضعف</button>
              <button className={`tb${tab === 'witnesses' ? ' active' : ''}`} onClick={() => setTab('witnesses')}>الشهود</button>
              <button className={`tb${tab === 'docs' ? ' active' : ''}`} onClick={() => setTab('docs')}>المستندات</button>
            </div>
            {tab === 'strategy' && (
              <div className="tp active">
                <Risk type="ok" title="✅ الاستراتيجية الموصى بها" text="التركيز على إثبات عدم صحة إجراء الإنهاء وفق المادة 32 من قانون العمل." />
                <Risk type="wn" title="⚠️ خطر — الطرف المقابل يمتلك سجلات حضور" text="يجب الطعن في دقة هذه السجلات أو إثبات التناقض فيها." />
                <Risk type="ok" title="✅ مستندات قوية بحوزتنا" text="رسائل بريد إلكتروني تثبت التمييز + شهادة زميلين." />
              </div>
            )}
            {tab === 'strength' && (
              <div className="tp active">
                <Risk type="ok" title="نقطة قوة" text="عدم وجود إنذار مسبق قبل الفصل — مخالفة صريحة للإجراءات." />
                <Risk type="ok" title="نقطة قوة" text="مدة الخدمة 7 سنوات تعزز مطالبة التعويض." />
                <Risk type="dn" title="نقطة ضعف" text="الطرف المقابل يدّعي وجود مخالفات إدارية موثقة." />
              </div>
            )}
            {tab === 'witnesses' && <div className="tp active" style={{ fontSize: '.8rem', color: '#CBD5E1', lineHeight: 1.9 }}>1. هل تم توجيه إنذار كتابي قبل قرار الفصل؟<br />2. من أصدر قرار الإنهاء وما صلاحياته؟<br />3. هل اتُّبعت إجراءات النظام الداخلي كاملة؟</div>}
            {tab === 'docs' && (
              <div className="tp active">
                <Risk type="dn" title="❌ مستند ناقص — قرار الفصل الرسمي" text="لم نستلم نسخة موقعة من قرار إنهاء الخدمة." />
                <Risk type="wn" title="⚠️ مطلوب — كشف الراتب آخر 6 أشهر" text="لحساب التعويض المستحق بدقة." />
                <Risk type="ok" title="✅ متوفر — عقد العمل الأصلي وملاحقه" text="مرفق ضمن ملف القضية." />
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

type DocItem = { id: string; name: string; type: string; size: number; url: string | null; createdAt: string; case: { number: string; title: string } | null }

function docIcon(type: string) {
  if (type?.toLowerCase().includes('pdf')) return '📕'
  if (type?.toLowerCase().includes('doc')) return '📘'
  if (type?.toLowerCase().includes('xls') || type?.toLowerCase().includes('sheet')) return '📗'
  if (type?.toLowerCase().includes('image') || /\.(jpg|jpeg|png|gif|webp)/i.test(type)) return '🖼️'
  return '📄'
}

function fmtSize(bytes: number) {
  if (bytes >= 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' MB'
  if (bytes >= 1024) return Math.round(bytes / 1024) + ' KB'
  return bytes + ' B'
}

function DocumentsPage() {
  const [docs, setDocs] = useState<DocItem[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState('الكل')
  const uploadRef = useRef<HTMLInputElement | null>(null)
  const [cases, setCases] = useState<{ id: string; number: string; title: string }[]>([])
  const [pendingFile, setPendingFile] = useState<File | null>(null)
  const [selectedCase, setSelectedCase] = useState('')
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState('')

  const loadDocs = useCallback(() => {
    setLoading(true)
    fetch('/api/documents').then(r => r.json()).then(d => { if (Array.isArray(d)) setDocs(d) }).catch(() => {}).finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    loadDocs()
    fetch('/api/cases').then(r => r.json()).then(d => {
      if (Array.isArray(d)) setCases(d.map((c: any) => ({ id: c.id, number: c.number, title: c.title })))
    }).catch(() => {})
  }, [loadDocs])

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    if (f) { setPendingFile(f); setUploadError('') }
    e.target.value = ''
  }

  const doUpload = async () => {
    if (!pendingFile) return
    setUploading(true); setUploadError('')
    try {
      const fd = new FormData()
      fd.append('file', pendingFile)
      if (selectedCase) fd.append('caseId', selectedCase)
      const res = await fetch('/api/documents/upload', { method: 'POST', body: fd })
      const data = await res.json()
      if (!res.ok) { setUploadError(data.error || 'فشل الرفع'); return }
      setPendingFile(null); setSelectedCase('')
      loadDocs()
    } catch { setUploadError('تعذّر رفع الملف') }
    finally { setUploading(false) }
  }

  const filtered = docs.filter(d => {
    const q = search.toLowerCase()
    const matchSearch = !q || d.name.toLowerCase().includes(q) || d.case?.number.includes(q) || false
    const matchFilter = filter === 'الكل' || (filter === 'PDF' && d.type.toLowerCase().includes('pdf')) ||
      (filter === 'Word' && d.type.toLowerCase().includes('doc')) ||
      (filter === 'Excel' && (d.type.toLowerCase().includes('xls') || d.type.toLowerCase().includes('sheet'))) ||
      (filter === 'صور' && /image|\.(jpg|jpeg|png)/i.test(d.type))
    return matchSearch && matchFilter
  })

  return (
    <div className="pg">
      <SectionHeader title="إدارة الملفات" subtitle={loading ? 'جاري التحميل...' : `${docs.length} ملف`}>
        <input ref={uploadRef} type="file" accept=".pdf,.doc,.docx,.xls,.xlsx,.jpg,.jpeg,.png" style={{ display: 'none' }} onChange={handleFile} />
        <button className="dbtn dbtn-p" onClick={() => uploadRef.current?.click()}>⬆ رفع ملف</button>
      </SectionHeader>

      {pendingFile && (
        <div className="card" style={{ marginBottom: 14, border: '1px solid rgba(212,175,55,.3)' }}>
          <div className="ct">📎 {pendingFile.name} — {fmtSize(pendingFile.size)}</div>
          <div className="fg" style={{ marginBottom: 10 }}>
            <label className="fl">ربط بقضية (اختياري)</label>
            <select className="fi" value={selectedCase} onChange={e => setSelectedCase(e.target.value)}>
              <option value="">— بدون ربط —</option>
              {cases.map(c => <option key={c.id} value={c.id}>{c.number} — {c.title}</option>)}
            </select>
          </div>
          {uploadError && <div style={{ color: '#F87171', fontSize: '.8rem', marginBottom: 8 }}>⚠️ {uploadError}</div>}
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="dbtn dbtn-p" onClick={doUpload} disabled={uploading}>{uploading ? 'جارٍ الرفع...' : '⬆ رفع الآن'}</button>
            <button className="dbtn dbtn-s" onClick={() => { setPendingFile(null); setUploadError('') }}>إلغاء</button>
          </div>
        </div>
      )}

      <div className="sb2"><div className="si">🔍</div><input placeholder="ابحث في الملفات..." value={search} onChange={e => setSearch(e.target.value)} /></div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
        {['الكل', 'PDF', 'Word', 'Excel', 'صور'].map(label => (
          <button key={label} className={`dbtn ${filter === label ? 'dbtn-p' : 'dbtn-s'}`} style={{ fontSize: '.74rem' }} onClick={() => setFilter(label)}>{label}</button>
        ))}
      </div>
      <div className="card">
        <div className="ct">📁 المستندات</div>
        {loading ? (
          <div style={{ color: '#64748B', textAlign: 'center', padding: 24 }}>جاري التحميل...</div>
        ) : filtered.length === 0 ? (
          <div style={{ color: '#64748B', textAlign: 'center', padding: 24 }}>لا توجد ملفات</div>
        ) : (
          <div className="fg2">
            {filtered.map(d => (
              <div className="fc" key={d.id}>
                <div className="fic">{docIcon(d.type)}</div>
                <div className="fnm">{d.name}</div>
                <div className="fsz">{fmtSize(d.size)} · {d.case ? d.case.number : '—'}</div>
                {d.url && (
                  <a href={d.url} download={d.name} style={{ fontSize: '.7rem', color: 'var(--gold)', marginTop: 4, display: 'block' }}>⬇ تحميل</a>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function FileSearchPage() {
  const [query, setQuery] = useState('')
  const [searched, setSearched] = useState(false)
  const [loading, setLoading] = useState(false)
  const [docs, setDocs] = useState<{ id: string; name: string; type: string; case: { number: string } | null }[]>([])

  const search = async (value = query) => {
    setQuery(value)
    if (value.trim().length < 2) return
    setSearched(true); setLoading(true)
    try {
      const res = await fetch(`/api/search?q=${encodeURIComponent(value.trim())}`)
      const data = await res.json()
      setDocs(Array.isArray(data.documents) ? data.documents : [])
    } catch { setDocs([]) } finally { setLoading(false) }
  }

  return (
    <div className="pg">
      <SectionHeader title="البحث داخل الملفات" subtitle="ابحث باسم الملف ضمن مستنداتك المرفوعة" />
      <div className="sb2" style={{ background: 'rgba(37,99,235,.05)', borderColor: 'rgba(37,99,235,.2)' }}>
        <div className="si">📂</div>
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="اسم الملف أو جزء منه..." onKeyDown={(e) => e.key === 'Enter' && search()} />
        <button className="dbtn dbtn-p" onClick={() => search()}>🔍</button>
      </div>
      {!searched ? (
        <div className="card">
          <div className="ct">💡 كيف يعمل البحث</div>
          <div style={{ color: '#94A3B8', fontSize: '.82rem', lineHeight: 1.8 }}>يبحث هذا الحقل باسم الملف ضمن المستندات التي رفعتها أو التي على قضاياك فقط.</div>
        </div>
      ) : (
        <div className="card">
          <div className="ct">📂 نتائج البحث في الملفات</div>
          {loading ? (
            <div style={{ color: '#64748B', textAlign: 'center', padding: 24 }}>جارٍ البحث...</div>
          ) : docs.length === 0 ? (
            <div style={{ color: '#64748B', textAlign: 'center', padding: 24 }}>لا توجد نتائج</div>
          ) : (
            <div className="fg2">
              {docs.map((d) => <FileHit key={d.id} icon={docIcon(d.type)} name={d.name} status={d.case ? `قضية ${d.case.number}` : 'بدون قضية'} color="#94A3B8" />)}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function FileHit({ icon, name, status, color }: { icon: string; name: string; status: string; color: string }) {
  return (
    <div className="fc">
      <div className="fic">{icon}</div>
      <div className="fnm">{name}</div>
      <div className="fsz" style={{ color }}>{status}</div>
    </div>
  )
}

function OcrPage({ switchPage }: { switchPage: (id: PageId) => void }) {
  const [done, setDone] = useState(false)
  return (
    <div className="pg">
      <SectionHeader title="تحويل الصور إلى نص (OCR)" subtitle="ارفع صورة أو مستند ممسوح وحوّله إلى نص قابل للتحرير" />
      <div className="g2">
        <div className="card">
          <div className="ct">📷 رفع الصورة</div>
          <button className="upl" onClick={() => setDone(true)}>
            <div className="uic">📷</div>
            <div className="ut">ارفع صورة أو PDF ممسوح</div>
            <div className="uh">JPG · PNG · PDF · حتى 20MB</div>
          </button>
          <div style={{ marginTop: 12 }}><button className="dbtn dbtn-p" onClick={() => setDone(true)}>🔍 تحويل إلى نص</button></div>
        </div>
        {done && (
          <div className="card">
            <div className="ct">📝 النص المستخرج <Badge type="ac">دقة 98%</Badge></div>
            <textarea className="fi" style={{ minHeight: 200, fontSize: '.82rem', lineHeight: 1.8 }} defaultValue={'عقد بيع عقار\nمحرر في عمّان بتاريخ 15/03/2024\nالطرف الأول: السيد محمود حسين العمري — رقم الهوية: 9XXXXXXXX\nالطرف الثاني: السيد كريم سالم الزيود — رقم الهوية: 9XXXXXXXX\nباع الطرف الأول للطرف الثاني العقار الكائن في منطقة الرابية — عمّان\nرقم القطعة: 1234/56 — المساحة: 420 متر مربع\nبسعر قدره: مئتان وخمسون ألف دينار أردني (250,000 د.أ)\n...'} />
            <div style={{ marginTop: 10, display: 'flex', gap: 7 }}>
              <button className="dbtn dbtn-p" onClick={() => switchPage('ai-contract')}>🔍 تحليل بالذكاء الاصطناعي</button>
              <button className="dbtn dbtn-s">📋 نسخ النص</button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function DocComparePage() {
  const [text1, setText1] = useState('')
  const [text2, setText2] = useState('')
  const [diffResult, setDiffResult] = useState<{ type: 'same' | 'add' | 'del'; text: string }[] | null>(null)

  function computeDiff(a: string, b: string) {
    const la = a.split('\n').filter(l => l.trim())
    const lb = b.split('\n').filter(l => l.trim())
    const m = la.length, n = lb.length
    const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0))
    for (let i = 1; i <= m; i++)
      for (let j = 1; j <= n; j++)
        dp[i][j] = la[i-1] === lb[j-1] ? dp[i-1][j-1] + 1 : Math.max(dp[i-1][j], dp[i][j-1])
    const result: { type: 'same' | 'add' | 'del'; text: string }[] = []
    let i = m, j = n
    while (i > 0 || j > 0) {
      if (i > 0 && j > 0 && la[i-1] === lb[j-1]) { result.unshift({ type: 'same', text: la[i-1] }); i--; j-- }
      else if (j > 0 && (i === 0 || dp[i][j-1] >= dp[i-1][j])) { result.unshift({ type: 'add', text: lb[j-1] }); j-- }
      else { result.unshift({ type: 'del', text: la[i-1] }); i-- }
    }
    return result
  }

  const added = diffResult?.filter(d => d.type === 'add').length ?? 0
  const deleted = diffResult?.filter(d => d.type === 'del').length ?? 0
  const same = diffResult?.filter(d => d.type === 'same').length ?? 0

  return (
    <div className="pg">
      <SectionHeader title="مقارنة مستندين" subtitle="الصق نص المستندين وشاهد الفرق سطراً بسطر" />
      <div className="g2" style={{ marginBottom: 14 }}>
        <div className="card">
          <div className="ct">📄 المستند الأول — القديم</div>
          <textarea className="fi" style={{ minHeight: 220, fontSize: '.8rem', lineHeight: 1.8 }} placeholder="الصق نص المستند القديم هنا..." value={text1} onChange={e => setText1(e.target.value)} />
        </div>
        <div className="card">
          <div className="ct">📄 المستند الثاني — الجديد</div>
          <textarea className="fi" style={{ minHeight: 220, fontSize: '.8rem', lineHeight: 1.8 }} placeholder="الصق نص المستند الجديد هنا..." value={text2} onChange={e => setText2(e.target.value)} />
        </div>
      </div>
      <div style={{ marginBottom: 14 }}>
        <button className="dbtn dbtn-p" disabled={!text1.trim() || !text2.trim()} onClick={() => setDiffResult(computeDiff(text1, text2))}>🔀 مقارنة المستندين</button>
        {diffResult && <button className="dbtn dbtn-s" style={{ marginRight: 8 }} onClick={() => { setDiffResult(null); setText1(''); setText2('') }}>مسح</button>}
      </div>
      {diffResult && (
        <div className="card">
          <div className="ct">📊 نتائج المقارنة</div>
          <div style={{ display: 'flex', gap: 20, marginBottom: 12, fontSize: '.78rem' }}>
            <span style={{ color: '#6EE7B7' }}>● {added} سطر مضاف</span>
            <span style={{ color: '#FCA5A5' }}>● {deleted} سطر محذوف</span>
            <span style={{ color: '#94A3B8' }}>● {same} سطر مشترك</span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            {diffResult.map((d, i) => d.text ? (
              <div key={i} className={`df ${d.type === 'add' ? 'add' : d.type === 'del' ? 'del' : 'same'}`}>
                {d.type === 'add' ? '+ ' : d.type === 'del' ? '- ' : '  '}{d.text}
              </div>
            ) : null)}
          </div>
        </div>
      )}
    </div>
  )
}

function DocGenPage({ switchPage }: { switchPage: (id: PageId) => void }) {
  const [selected, setSelected] = useState('مذكرة دفاع')
  const [plaintiff, setPlaintiff] = useState('')
  const [defendant, setDefendant] = useState('')
  const [court, setCourt] = useState('بداية عمّان المدنية')
  const [caseNum, setCaseNum] = useState('')
  const [subject, setSubject] = useState('')
  const [generated, setGenerated] = useState(false)

  const docTypes = [['📋', 'صحيفة دعوى'], ['📩', 'لائحة جوابية'], ['🛡️', 'مذكرة دفاع'], ['⚠️', 'إنذار عدلي'], ['📜', 'وكالة قانونية'], ['🤝', 'عقد']]

  const getContent = () => {
    const date = new Date().toLocaleDateString('ar-JO', { year: 'numeric', month: 'long', day: 'numeric' })
    const p = plaintiff || '___'; const d = defendant || '___'; const s = subject || '___'; const n = caseNum || 'XXXX/2026'
    const map: Record<string, string> = {
      'صحيفة دعوى': `بسم الله الرحمن الرحيم\nالمملكة الأردنية الهاشمية — محكمة ${court}\n\nصحيفة دعوى — رقم ${n}\n\nالطرف الأول (المدعي): ${p}\nالطرف الثاني (المدعى عليه): ${d}\n\nالموضوع:\n${s}\n\nيرجو المدعي التفضل بالنظر في دعواه وفق الأصول القانونية والحكم لصالحه.\n\nعمّان، ${date}\n\nتوقيع المحامي: ___________`,
      'لائحة جوابية': `بسم الله الرحمن الرحيم\nالمملكة الأردنية الهاشمية — محكمة ${court}\n\nلائحة جوابية — القضية رقم ${n}\n\nالمدعي: ${p}\nالمدعى عليه: ${d}\n\nبالإشارة إلى لائحة الدعوى، نرد عليها ونفنّدها:\n${s}\n\nنلتمس من عدالة المحكمة رد الدعوى لعدم الصحة وإلزام المدعي بالرسوم.\n\nعمّان، ${date}`,
      'مذكرة دفاع': `بسم الله الرحمن الرحيم\nالمملكة الأردنية الهاشمية — محكمة ${court}\n\nمذكرة دفاع — القضية رقم ${n}\n\nالموكل: ${p}\nالخصم: ${d}\n\nأولاً — من حيث الوقائع:\n${s}\n\nثانياً — من حيث القانون:\nاستناداً لأحكام القانون الأردني المعمول به، يثبت للموكل حقه الكامل.\n\nالطلب: إصدار الحكم لصالح الموكل مع إلزام الخصم بالرسوم وأتعاب المحاماة.\n\nعمّان، ${date}`,
      'إنذار عدلي': `بسم الله الرحمن الرحيم\nإنذار عدلي\n\nأنا الموقّع أدناه، ${p}، أُنذر السيد / ${d} بما يلي:\n${s}\n\nوأُحذّره من مغبّة الإخلال بالتزاماته، مع الاحتفاظ بكامل حقوقي القانونية.\n\nعمّان، ${date}`,
      'وكالة قانونية': `بسم الله الرحمن الرحيم\nوكالة قانونية\n\nأنا الموكّل: ${p}\nأوكّل وأُفوّض المحامي / ${d}\n\nللنيابة عني في: ${s}\n\nوذلك أمام محكمة ${court} ودرجاتها المختلفة.\n\nصدر هذا التوكيل بتاريخ: ${date}\n\nتوقيع الموكّل: ___________`,
      'عقد': `بسم الله الرحمن الرحيم\nعقد\n\nمحرّر في عمّان بتاريخ: ${date}\n\nالطرف الأول: ${p}\nالطرف الثاني: ${d}\n\nالموضوع: ${s}\n\nاتفق الطرفان على البنود المذكورة، وتعهّد كل منهما بالالتزام بها وفق أحكام القانون الأردني.\n\nتوقيع الطرف الأول: ___________     توقيع الطرف الثاني: ___________`,
    }
    return map[selected] ?? `مستند: ${selected}\n\nالطرف الأول: ${p}\nالطرف الثاني: ${d}\n\n${s}`
  }

  const printDoc = () => {
    const content = getContent()
    const win = window.open('', '_blank', 'width=800,height=900')
    if (!win) return
    win.document.write(`<!DOCTYPE html><html dir="rtl"><head><meta charset="utf-8"><title>${selected}</title><style>body{font-family:Arial,sans-serif;font-size:14pt;line-height:2;padding:60px 80px;color:#000;direction:rtl;white-space:pre-wrap}@page{margin:2cm}@media print{body{padding:0}}</style></head><body>${content.replace(/\n/g, '<br>')}</body></html>`)
    win.document.close()
    setTimeout(() => { win.focus(); win.print() }, 400)
  }

  const copyDoc = () => { navigator.clipboard.writeText(getContent()) }

  return (
    <div className="pg">
      <SectionHeader title="إنشاء المستندات القانونية" subtitle="توليد مستندات احترافية في ثوانٍ" />
      <div className="g3" style={{ marginBottom: 16 }}>
        {docTypes.map(([icon, label]) => (
          <button key={label} className={`ctc${selected === label ? ' sel' : ''}`} onClick={() => { setSelected(label); setGenerated(false) }}>
            <div className="ctci">{icon}</div><div className="ctcl">{label}</div>
          </button>
        ))}
      </div>
      <div className="g2">
        <div className="card">
          <div className="ct">📝 بيانات المستند</div>
          <div className="fg">
            <Field label="المدعي / الموكل / الطرف الأول"><input className="fi" value={plaintiff} onChange={e => setPlaintiff(e.target.value)} placeholder="الاسم الكامل" /></Field>
            <Field label="المدعى عليه / الخصم / الطرف الثاني"><input className="fi" value={defendant} onChange={e => setDefendant(e.target.value)} placeholder="الاسم الكامل" /></Field>
            <Field label="المحكمة">
              <select className="fi" value={court} onChange={e => setCourt(e.target.value)}>
                <option>بداية عمّان المدنية</option><option>استئناف عمّان</option><option>محكمة التمييز</option>
                <option>تجارية عمّان</option><option>صلح عمّان</option><option>شرعية عمّان</option>
              </select>
            </Field>
            <Field label="رقم القضية"><input className="fi" value={caseNum} onChange={e => setCaseNum(e.target.value)} placeholder="2026/XXXX" /></Field>
            <Field label="الموضوع / التفاصيل" full>
              <textarea className="fi" style={{ minHeight: 100 }} value={subject} onChange={e => setSubject(e.target.value)} placeholder="اشرح موضوع المستند..." />
            </Field>
          </div>
          <button className="dbtn dbtn-p" style={{ marginTop: 10 }} onClick={() => setGenerated(true)}>✨ توليد المستند</button>
        </div>
        <div className="card">
          <div className="ct">👁️ المعاينة</div>
          <div style={{ background: '#fff', borderRadius: 8, padding: 16, minHeight: 220, color: '#1E293B', fontSize: '.8rem', lineHeight: 1.9 }}>
            {generated
              ? <pre style={{ whiteSpace: 'pre-wrap', margin: 0, fontFamily: 'inherit', fontSize: '.8rem', lineHeight: 1.9 }}>{getContent()}</pre>
              : <div style={{ textAlign: 'center', color: '#94A3B8', marginTop: 24 }}>أدخل البيانات واضغط "توليد المستند"</div>
            }
          </div>
          {generated && (
            <div style={{ marginTop: 10, display: 'flex', gap: 7 }}>
              <button className="dbtn dbtn-p" onClick={printDoc}>🖨️ طباعة / PDF</button>
              <button className="dbtn dbtn-s" onClick={copyDoc}>📋 نسخ</button>
              <button className="dbtn dbtn-s" onClick={() => switchPage('esign')}>🖊️ توقيع</button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function EsignPage() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const drawingRef = useRef(false)
  const lastPointRef = useRef<{ x: number; y: number } | null>(null)
  const [docs, setDocs] = useState<{ id: string; name: string; caseId: string | null; case: { number: string; title: string } | null }[]>([])
  const [selectedDoc, setSelectedDoc] = useState('')
  const [saving, setSaving] = useState(false)
  const [saveMsg, setSaveMsg] = useState('')
  const [saveErr, setSaveErr] = useState('')

  const loadDocs = useCallback(() => {
    fetch('/api/documents').then(r => r.json()).then(d => { if (Array.isArray(d)) setDocs(d) }).catch(() => {})
  }, [])
  useEffect(() => { loadDocs() }, [loadDocs])

  const signedDocs = docs.filter(d => d.name.startsWith('توقيع - '))
  const chosen = docs.find(d => d.id === selectedDoc)

  async function saveSignature() {
    const canvas = canvasRef.current
    if (!canvas) return
    setSaving(true); setSaveMsg(''); setSaveErr('')
    try {
      const blob: Blob | null = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'))
      if (!blob) { setSaveErr('لا يوجد توقيع مرسوم بعد'); return }
      const fd = new FormData()
      const fileName = `توقيع - ${chosen?.name ?? 'مستند'}.png`
      fd.append('file', new File([blob], fileName, { type: 'image/png' }))
      if (chosen?.caseId) fd.append('caseId', chosen.caseId)
      const res = await fetch('/api/documents/upload', { method: 'POST', body: fd })
      const data = await res.json()
      if (!res.ok) { setSaveErr(data.error || 'فشل حفظ التوقيع'); return }
      setSaveMsg('✅ تم حفظ التوقيع كمستند مرتبط')
      loadDocs()
    } catch { setSaveErr('تعذّر الاتصال بالخادم') } finally { setSaving(false) }
  }

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const resize = () => {
      const rect = canvas.getBoundingClientRect()
      const ratio = window.devicePixelRatio || 1
      canvas.width = Math.max(1, Math.floor(rect.width * ratio))
      canvas.height = Math.floor(170 * ratio)
      const ctx = canvas.getContext('2d')
      if (!ctx) return
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0)
      ctx.strokeStyle = '#D4AF37'
      ctx.lineWidth = 2
      ctx.lineCap = 'round'
      ctx.lineJoin = 'round'
    }
    resize()
    window.addEventListener('resize', resize)
    return () => window.removeEventListener('resize', resize)
  }, [])

  const point = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = event.currentTarget.getBoundingClientRect()
    return { x: event.clientX - rect.left, y: event.clientY - rect.top }
  }

  const start = (event: React.PointerEvent<HTMLCanvasElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId)
    drawingRef.current = true
    lastPointRef.current = point(event)
  }

  const move = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawingRef.current) return
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    const last = lastPointRef.current
    const next = point(event)
    if (!ctx || !last) return
    ctx.beginPath()
    ctx.moveTo(last.x, last.y)
    ctx.lineTo(next.x, next.y)
    ctx.stroke()
    lastPointRef.current = next
  }

  const stop = () => {
    drawingRef.current = false
    lastPointRef.current = null
  }

  const clear = () => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return
    ctx.clearRect(0, 0, canvas.width, canvas.height)
  }

  return (
    <div className="pg">
      <SectionHeader title="التوقيع الإلكتروني" subtitle="وقّع العقود والمستندات رقمياً" />
      <div className="g2">
        <div className="card">
          <div className="ct">📄 المستند للتوقيع</div>
          <Field label="اختر مستنداً من ملفات المكتب" full>
            <select className="fi" value={selectedDoc} onChange={(e) => setSelectedDoc(e.target.value)}>
              <option value="">— اختر مستنداً —</option>
              {docs.filter(d => !d.name.startsWith('توقيع - ')).map(d => <option key={d.id} value={d.id}>{d.name}{d.case ? ` — قضية ${d.case.number}` : ''}</option>)}
            </select>
          </Field>
          {chosen ? (
            <div style={{ background: '#fff', borderRadius: 8, padding: 14, color: '#1E293B', fontSize: '.8rem', lineHeight: 1.9, marginTop: 12 }}>
              <b style={{ display: 'block', textAlign: 'center', marginBottom: 8 }}>{chosen.name}</b>
              {chosen.case && <p style={{ textAlign: 'center', color: '#64748B' }}>قضية {chosen.case.number} — {chosen.case.title}</p>}
              <a href={`/api/documents/${chosen.id}/download`} style={{ display: 'block', textAlign: 'center', color: '#2563EB', marginTop: 8 }}>⬇ تحميل المستند الأصلي</a>
            </div>
          ) : (
            <div style={{ color: '#64748B', fontSize: '.8rem', padding: '20px 0', textAlign: 'center' }}>اختر مستنداً من القائمة، أو ارفعه أولاً من "إدارة الملفات"، ثم وقّعه أدناه.</div>
          )}
        </div>
        <div className="card">
          <div className="ct">🖊️ لوحة التوقيع</div>
          <canvas ref={canvasRef} id="sig-canvas" onPointerDown={start} onPointerMove={move} onPointerUp={stop} onPointerLeave={stop} />
          <div style={{ marginTop: 10, display: 'flex', gap: 7, flexWrap: 'wrap' }}>
            <button className="dbtn dbtn-p" onClick={saveSignature} disabled={saving}>{saving ? 'جارٍ الحفظ...' : '✅ حفظ التوقيع على المستند'}</button>
            <button className="dbtn dbtn-s" onClick={clear}>🗑️ مسح</button>
            <button className="dbtn dbtn-g" onClick={() => {
              const canvas = canvasRef.current; if (!canvas) return
              const img = canvas.toDataURL('image/png')
              const win = window.open('', '_blank'); if (!win) return
              win.document.write(`<html><body style="margin:0;background:#fff"><img src="${img}" style="max-width:100%"></body></html>`)
            }}>👁️ معاينة</button>
          </div>
          {saveMsg && <div style={{ color: '#10B981', fontSize: '.8rem', marginTop: 8 }}>{saveMsg}</div>}
          {saveErr && <div style={{ color: '#F87171', fontSize: '.8rem', marginTop: 8 }}>⚠ {saveErr}</div>}
          <div style={{ marginTop: 14, borderTop: '1px solid rgba(255,255,255,.06)', paddingTop: 12 }}>
            <div className="ct" style={{ marginBottom: 10 }}>📋 آخر التواقيع المحفوظة</div>
            {signedDocs.length === 0 ? (
              <div style={{ fontSize: '.8rem', color: '#64748B' }}>لا توجد توقيعات محفوظة بعد</div>
            ) : signedDocs.slice(0, 5).map(d => (
              <div key={d.id} style={{ fontSize: '.8rem', color: '#94A3B8', padding: 8, background: 'rgba(255,255,255,.03)', borderRadius: 8, marginBottom: 6 }}>📄 {d.name}</div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

function LegalSearchPage() {
  const [query, setQuery] = useState('')
  const [result, setResult] = useState<string | null>(null)
  const db: Record<string, string> = {
    'إجازة مرضية': 'المادة 65 من قانون العمل الأردني تنص على أن العامل يستحق إجازة مرضية ضمن حدود القانون، ولا يجوز استعمال المرض كسبب تعسفي للفصل.',
    استئناف: 'مدة الاستئناف في القضايا المدنية تكون غالباً 30 يوماً من تاريخ تبليغ الحكم، مع مراعاة الأحكام الخاصة.',
    'شركة ذات': 'يتطلب تسجيل شركة ذات مسؤولية محدودة عقد تأسيس موثقاً وبيانات الشركاء ورأس المال والتسجيل لدى دائرة مراقبة الشركات.',
    مستأجر: 'لا يُخلى المستأجر إلا وفق أسباب وإجراءات يحددها القانون وبقرار قضائي عند النزاع.',
  }
  const search = (value = query) => {
    setQuery(value)
    const key = Object.keys(db).find((item) => value.includes(item))
    setResult(key ? db[key] : 'بناءً على البحث في التشريعات الأردنية، وُجدت نتائج متعددة تتعلق باستفساركم. يُنصح بمراجعة القوانين ذات الصلة.')
  }
  return (
    <div className="pg">
      <SectionHeader title="البحث القانوني" subtitle="ابحث في القوانين والأنظمة والأحكام الأردنية" />
      <div className="sb2"><div className="si">⚖️</div><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="هل يجوز فصل الموظف أثناء الإجازة المرضية؟" onKeyDown={(e) => e.key === 'Enter' && search()} /><button className="dbtn dbtn-p" onClick={() => search()}>بحث</button></div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
        {['هل يجوز فصل الموظف أثناء الإجازة المرضية؟', 'ما شروط تسجيل شركة ذات مسؤولية محدودة في الأردن؟', 'ما حقوق المستأجر عند طلب الإخلاء؟', 'ما هي إجراءات الاستئناف المدني؟'].map((q) => <button key={q} className="dbtn dbtn-s" style={{ fontSize: '.74rem' }} onClick={() => search(q)}>{q}</button>)}
      </div>
      {result && (
        <>
          <LegalResult title="⚖️ قانون العمل الأردني — مادة ذات صلة" mat="المرجع: التشريعات الأردنية" text={result} why="✓ سبب الاختيار: الأكثر صلة بسؤالك وفق نظام RAG" />
          <LegalResult title="📋 قرار تمييزي مشابه" mat="محكمة التمييز الأردنية — الغرفة المدنية" text="قررت المحكمة أن مخالفة الإجراءات الجوهرية في إنهاء العلاقة التعاقدية تؤثر في مشروعية القرار وتفتح باب التعويض." why="✓ حكم مشابه — نسبة التطابق 87%" />
        </>
      )}
    </div>
  )
}

function LegalResult({ title, mat, text, why }: { title: string; mat: string; text: string; why: string }) {
  return (
    <div className="lrc">
      <div className="lrc-title">{title}</div>
      <div className="lrc-mat">{mat}</div>
      <div className="lrc-text">{text}</div>
      <div className="lrc-why">{why}</div>
    </div>
  )
}

type OfficeSearchResults = {
  clients: { id: string; name: string; phone: string | null; email: string | null }[]
  cases: { id: string; number: string; title: string; status: string; client: { name: string } }[]
  invoices: { id: string; number: string; amount: number; status: string; client: { name: string } }[]
  documents: { id: string; name: string; type: string; case: { number: string } | null }[]
}

function OfficeSearchPage() {
  const [query, setQuery] = useState('')
  const [searched, setSearched] = useState(false)
  const [loading, setLoading] = useState(false)
  const [results, setResults] = useState<OfficeSearchResults>({ clients: [], cases: [], invoices: [], documents: [] })

  const search = async (value = query) => {
    setQuery(value)
    if (value.trim().length < 2) return
    setSearched(true); setLoading(true)
    try {
      const res = await fetch(`/api/search?q=${encodeURIComponent(value.trim())}`)
      const data = await res.json()
      setResults({
        clients: Array.isArray(data.clients) ? data.clients : [],
        cases: Array.isArray(data.cases) ? data.cases : [],
        invoices: Array.isArray(data.invoices) ? data.invoices : [],
        documents: Array.isArray(data.documents) ? data.documents : [],
      })
    } catch { setResults({ clients: [], cases: [], invoices: [], documents: [] }) } finally { setLoading(false) }
  }

  const totalHits = results.clients.length + results.cases.length + results.invoices.length + results.documents.length

  return (
    <div className="pg">
      <SectionHeader title="محرك بحث المكتب" subtitle="ابحث بالاسم أو الرقم عبر العملاء والقضايا والفواتير والملفات" />
      <div className="sb2" style={{ background: 'rgba(212,175,55,.05)', borderColor: 'rgba(212,175,55,.2)' }}>
        <div className="si">🏢</div>
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="اسم عميل، رقم قضية، رقم فاتورة، اسم ملف..." onKeyDown={(e) => e.key === 'Enter' && search()} />
        <button className="dbtn dbtn-p" onClick={() => search()}>🔍 بحث</button>
      </div>
      {searched && (
        loading ? (
          <div className="card"><div style={{ color: '#64748B', textAlign: 'center', padding: 24 }}>جارٍ البحث...</div></div>
        ) : totalHits === 0 ? (
          <div className="card"><div style={{ color: '#64748B', textAlign: 'center', padding: 24 }}>لا توجد نتائج</div></div>
        ) : (
          <>
            {results.clients.length > 0 && (
              <div className="card" style={{ marginBottom: 14 }}>
                <div className="ct">👥 عملاء</div>
                {results.clients.map((c) => <InfoLine key={c.id} text={`${c.name} — ${c.phone ?? c.email ?? '—'}`} />)}
              </div>
            )}
            {results.cases.length > 0 && (
              <div className="card" style={{ marginBottom: 14 }}>
                <div className="ct">⚖️ قضايا</div>
                {results.cases.map((c) => <InfoLine key={c.id} text={`${c.number} — ${c.title} — ${c.client.name}`} badge={<Badge type={c.status === 'ACTIVE' ? 'ac' : 'cl'}>{statusAr[c.status] ?? c.status}</Badge>} />)}
              </div>
            )}
            {results.invoices.length > 0 && (
              <div className="card" style={{ marginBottom: 14 }}>
                <div className="ct">🧾 فواتير</div>
                {results.invoices.map((i) => <InfoLine key={i.id} text={`${i.number} — ${i.client.name} — ${i.amount.toLocaleString('ar-JO')} د.أ`} />)}
              </div>
            )}
            {results.documents.length > 0 && (
              <div className="card">
                <div className="ct">📂 ملفات</div>
                {results.documents.map((d) => <InfoLine key={d.id} text={`${d.name}${d.case ? ` — قضية ${d.case.number}` : ''}`} />)}
              </div>
            )}
          </>
        )
      )}
    </div>
  )
}

function ReportsPage() {
  const [data, setData] = useState<any>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/reports').then(r => r.json()).then(setData).catch(() => {}).finally(() => setLoading(false))
  }, [])

  if (loading) return <div className="pg"><div style={{ padding: 48, textAlign: 'center', color: '#94A3B8' }}>جارٍ تحميل التقارير...</div></div>

  const statusLabel: Record<string, string> = { ACTIVE: 'نشطة', CLOSED: 'مغلقة', SUSPENDED: 'موقوفة', PENDING: 'معلقة' }
  const totalCases = (data?.casesByStatus ?? []).reduce((s: number, c: any) => s + c._count._all, 0)
  const activeCases = (data?.casesByStatus ?? []).find((c: any) => c.status === 'ACTIVE')?._count._all ?? 0
  const unpaid = (data?.totalRevenue ?? 0) - (data?.totalPaid ?? 0)
  const maxType = Math.max(...((data?.casesByType ?? []).map((c: any) => c._count._all)), 1)

  return (
    <div className="pg">
      <SectionHeader title="التقارير والإحصائيات" subtitle={new Date().toLocaleDateString('ar-JO', { year: 'numeric', month: 'long' })}>
        <button className="dbtn dbtn-s" onClick={() => window.print()}>🖨️ طباعة</button>
      </SectionHeader>
      <div className="sg">
        <StatCard icon="⚖️" value={String(totalCases)} label="إجمالي القضايا" />
        <StatCard icon="📈" value={String(activeCases)} label="قضايا نشطة" />
        <StatCard icon="💰" value={fmtMoney(data?.totalPaid ?? 0)} label="إجمالي المحصّل" />
        <StatCard icon="⏳" value={fmtMoney(unpaid)} label="مستحقات غير محصّلة" />
      </div>
      <div className="g2" style={{ marginBottom: 14 }}>
        <div className="card">
          <div className="ct">⚖️ القضايا حسب الحالة</div>
          {totalCases === 0
            ? <div style={{ color: '#64748B', textAlign: 'center', padding: 16 }}>لا توجد قضايا</div>
            : <Bars items={(data?.casesByStatus ?? []).map((c: any) => [
                statusLabel[c.status] ?? c.status,
                String(c._count._all),
                `${Math.round((c._count._all / totalCases) * 100)}%`,
                c.status === 'ACTIVE' ? 'go' : c.status === 'CLOSED' ? '' : 'gn',
              ])} />
          }
        </div>
        <div className="card">
          <div className="ct">📋 القضايا حسب النوع</div>
          {(data?.casesByType ?? []).length === 0
            ? <div style={{ color: '#64748B', textAlign: 'center', padding: 16 }}>لا توجد بيانات</div>
            : <Bars items={(data?.casesByType ?? []).map((c: any) => [
                c.type,
                String(c._count._all),
                `${Math.round((c._count._all / maxType) * 100)}%`,
                'go',
              ])} />
          }
        </div>
      </div>
      <div className="card">
        <div className="ct">👨‍⚖️ الفريق القانوني — القضايا المسندة</div>
        {(data?.team ?? []).length === 0
          ? <div style={{ color: '#64748B', textAlign: 'center', padding: 16 }}>لا توجد بيانات</div>
          : <table className="dt"><tbody>
              <tr><th>الاسم</th><th>الدور</th><th>القضايا المسندة</th></tr>
              {(data?.team ?? []).map((m: any) => (
                <tr key={m.id}>
                  <td><b>{m.name}</b></td>
                  <td>{m.role === 'OFFICE_MANAGER' ? 'مدير المكتب' : 'محامي'}</td>
                  <td>{m._count.cases}</td>
                </tr>
              ))}
            </tbody></table>
        }
      </div>
      <div className="g2">
        <div className="card">
          <div className="ct">💳 الفواتير حسب الحالة</div>
          {(data?.invoicesByStatus ?? []).length === 0
            ? <div style={{ color: '#64748B', textAlign: 'center', padding: 16 }}>لا توجد فواتير</div>
            : <Bars items={(data?.invoicesByStatus ?? []).map((inv: any) => {
                const lblMap: Record<string, string> = { PAID: 'مدفوعة', UNPAID: 'غير مدفوعة', PARTIAL: 'جزئية', OVERDUE: 'متأخرة' }
                return [lblMap[inv.status] ?? inv.status, `${inv._count._all}`, `${Math.min(100, inv._count._all * 25)}%`, inv.status === 'PAID' ? 'go' : inv.status === 'OVERDUE' ? 'pink' : 'gn']
              })}
            />
          }
        </div>
        <div className="card">
          <div className="ct">📊 ملخص الإيرادات</div>
          <Bars items={[
            ['إجمالي الفواتير', fmtMoney(data?.totalRevenue ?? 0), '100%', 'go'],
            ['المحصّل', fmtMoney(data?.totalPaid ?? 0), data?.totalRevenue ? `${Math.round((data.totalPaid / data.totalRevenue) * 100)}%` : '0%', 'gn'],
            ['المتبقي', fmtMoney(unpaid), data?.totalRevenue ? `${Math.round((unpaid / data.totalRevenue) * 100)}%` : '0%', 'pink'],
          ]} />
        </div>
      </div>
    </div>
  )
}

function Bars({ items }: { items: string[][] }) {
  return (
    <div className="bc2">
      {items.map(([label, value, width, tone]) => (
        <div className="br" key={label}>
          <div className="brl">{label}</div>
          <div className="brt">
            <div className={`brf ${tone === 'go' ? 'go' : tone === 'gn' ? 'gn' : ''}`} style={{ width, background: tone === 'purple' ? 'linear-gradient(90deg,#7C3AED,#8B5CF6)' : tone === 'pink' ? 'linear-gradient(90deg,#DB2777,#EC4899)' : undefined }}>{value}</div>
          </div>
        </div>
      ))}
    </div>
  )
}

function EmailPage({ openModal, switchPage }: { openModal: OpenModal; switchPage: (id: PageId) => void }) {
  const [to, setTo] = useState('')
  const [emailSubject, setEmailSubject] = useState('')
  const [body, setBody] = useState('')
  const [sending, setSending] = useState(false)
  const [sendMsg, setSendMsg] = useState('')
  const [sendError, setSendError] = useState('')

  const send = async () => {
    setSending(true); setSendMsg(''); setSendError('')
    try {
      const res = await fetch('/api/email/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to, subject: emailSubject, body }),
      })
      const data = await res.json()
      if (!res.ok) setSendError(data.error || 'فشل الإرسال')
      else { setSendMsg('✅ تم إرسال الرسالة بنجاح'); setTo(''); setEmailSubject(''); setBody('') }
    } catch { setSendError('تعذّر الاتصال بالخادم') }
    finally { setSending(false) }
  }

  const loadDraft = (from: string, subj: string) => {
    setTo(''); setEmailSubject(`رداً: ${subj}`); setBody(`أخي / أختي ${from}،\n\nتحية طيبة وبعد،\n\n`)
  }

  return (
    <div className="pg">
      <SectionHeader title="البريد الإلكتروني" subtitle="الرسائل الواردة">
        <button className="dbtn dbtn-p" onClick={() => openModal('m-compose')}>✉️ رسالة جديدة</button>
      </SectionHeader>
      <div className="g2">
        <div className="card">
          <div className="ct">📥 الوارد</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {([
              ['نادين الخطيب', '10:23 ص', 'موعد جلسة قضية 2024/1701 — تأجيل إلى الأسبوع القادم', true],
              ['مجموعة النور', 'أمس', 'مراجعة العقد الجديد — مرفق للاطلاع والملاحظة', true],
              ['أحمد المصري', 'أمس', 'استفسار عن موعد جلسة الاستئناف القادمة', true],
              ['نقابة المحامين', 'الاثنين', 'إشعار تجديد اشتراك النقابة لعام 2026', false],
            ] as [string, string, string, boolean][]).map(([from, time, bodyText, unread]) => (
              <div key={from} onClick={() => loadDraft(from, bodyText)} style={{ padding: 10, background: unread ? 'rgba(37,99,235,.07)' : 'rgba(255,255,255,.03)', border: unread ? '1px solid rgba(37,99,235,.15)' : 'none', borderRadius: 9, cursor: 'pointer' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                  <b style={{ fontSize: '.82rem', color: unread ? '#E2E8F0' : '#94A3B8' }}>{from}</b>
                  <span style={{ fontSize: '.7rem', color: '#64748B' }}>{time}</span>
                </div>
                <div style={{ fontSize: '.78rem', color: unread ? '#94A3B8' : '#64748B' }}>{bodyText}</div>
              </div>
            ))}
          </div>
        </div>
        <div className="card">
          <div className="ct">✉️ إنشاء رسالة</div>
          <div className="fg" style={{ marginBottom: 12 }}>
            <Field label="إلى" full><input className="fi" value={to} onChange={e => setTo(e.target.value)} placeholder="email@example.com" /></Field>
            <Field label="الموضوع" full><input className="fi" value={emailSubject} onChange={e => setEmailSubject(e.target.value)} placeholder="موضوع الرسالة" /></Field>
            <Field label="الرسالة" full><textarea className="fi" style={{ minHeight: 130 }} value={body} onChange={e => setBody(e.target.value)} placeholder="اكتب رسالتك هنا..." /></Field>
          </div>
          {sendMsg && <div style={{ color: '#10B981', fontSize: '.82rem', marginBottom: 8 }}>{sendMsg}</div>}
          {sendError && <div style={{ color: '#F87171', fontSize: '.82rem', marginBottom: 8 }}>⚠️ {sendError}</div>}
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="dbtn dbtn-p" onClick={send} disabled={sending || !to || !emailSubject || !body}>
              {sending ? 'جارٍ الإرسال...' : '📤 إرسال'}
            </button>
            <button className="dbtn dbtn-s" onClick={() => switchPage('docs')}>📎 إرفاق ملف</button>
          </div>
          <div style={{ marginTop: 10, fontSize: '.74rem', color: '#64748B', background: 'rgba(255,255,255,.03)', borderRadius: 8, padding: '8px 12px' }}>
            💡 لإرسال رسائل حقيقية: أضف SMTP_HOST، SMTP_USER، SMTP_PASS في ملف .env — راجع .env.example
          </div>
        </div>
      </div>
    </div>
  )
}

function NotificationsPage() {
  const [notifs, setNotifs] = useState<any[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/notifications').then(r => r.json()).then(setNotifs).finally(() => setLoading(false))
  }, [])

  const unread = notifs.filter(n => !n.read).length

  const markAll = async () => {
    await fetch('/api/notifications', { method: 'PATCH' })
    setNotifs(notifs.map(n => ({ ...n, read: true })))
  }

  const timeAgo = (d: string) => {
    const diff = Date.now() - new Date(d).getTime()
    const m = Math.floor(diff / 60000)
    if (m < 1) return 'الآن'
    if (m < 60) return `منذ ${m} دقيقة`
    const h = Math.floor(m / 60)
    if (h < 24) return `منذ ${h} ساعة`
    return `منذ ${Math.floor(h / 24)} يوم`
  }

  return (
    <div className="pg">
      <SectionHeader title="الإشعارات" subtitle={`${unread} إشعار جديد`}>
        <button className="dbtn dbtn-s" onClick={markAll}>تحديد الكل كمقروء</button>
      </SectionHeader>
      <div className="card">
        {loading ? <div style={{ padding: 24, textAlign: 'center', color: '#94A3B8' }}>جارٍ التحميل...</div> : (
          notifs.length === 0
            ? <div style={{ padding: 24, textAlign: 'center', color: '#94A3B8' }}>لا توجد إشعارات</div>
            : notifs.map((n) => (
              <div key={n.id} style={{ opacity: n.read ? 0.6 : 1 }}>
                <Notification icon={n.read ? '📩' : '🔔'} color={n.read ? '#64748B' : '#F59E0B'} title={n.title} subtitle={n.body} time={timeAgo(n.createdAt)} />
              </div>
            ))
        )}
      </div>
    </div>
  )
}

function MojPage({ onGuide }: { onGuide: (service: string) => void }) {
  const groups = [
    ['● خدمات الاستعلام', ['لوحة البيانات', 'الاستعلام عن القضايا', 'القضايا التنفيذية', 'خدمة إخلاء سبيل'], 'gold'],
    ['● الدعاوى والطلبات', ['الدعاوى المدنية', 'إضافة وكيل على الدعاوى', 'الطلبات الإجرائية', 'إيداع الأوراق القضائية'], 'blue'],
    ['● الطعون والتسجيل', ['تسجيل الإعتراض', 'تسجيل الاستئناف', 'تسجيل التمييز ولوائحه', 'خدمات كاتب العدل'], 'green'],
  ]
  return (
    <div className="pg">
      <SectionHeader title="بوابة وزارة العدل" subtitle="الخدمات الإلكترونية القضائية">
        <a href="https://services.moj.gov.jo" target="_blank" className="dbtn dbtn-s" style={{ textDecoration: 'none' }}>🔗 فتح البوابة</a>
      </SectionHeader>
      <div style={{ background: 'rgba(245,158,11,.07)', border: '1px solid rgba(245,158,11,.2)', borderRadius: 11, padding: '12px 16px', marginBottom: 16, fontSize: '.82rem', color: '#F59E0B' }}>
        💡 هذه الخدمات تُفتح مباشرةً على بوابة وزارة العدل. يمكنك استخدام المساعد القانوني لمساعدتك في تعبئة النماذج.
      </div>
      <div className="g3">
        {groups.map(([label, services, tone]) => (
          <div key={String(label)} style={{ display: 'contents' }}>
            <div style={{ gridColumn: '1/-1', marginTop: 8 }}><div style={{ fontSize: '.68rem', fontWeight: 800, color: '#64748B', letterSpacing: '.08em', marginBottom: 8 }}>{label as string}</div></div>
            {(services as string[]).map((service) => (
              <button key={service} className="mjc" onClick={() => onGuide(service)}>
                <span className="mn">{service}</span>
                <span className="mai" style={{ background: tone === 'gold' ? 'rgba(212,175,55,.12)' : tone === 'blue' ? 'rgba(96,165,250,.12)' : 'rgba(52,211,153,.1)', color: tone === 'gold' ? 'var(--gold)' : tone === 'blue' ? '#60A5FA' : '#34D399' }}>+ مساعد</span>
              </button>
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}

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

function SettingsPage({
  authUser,
  onUserUpdate,
  isAdmin,
}: {
  authUser: AuthUser
  onUserUpdate: (user: AuthUser) => void
  isAdmin: boolean
}) {
  const [security, setSecurity] = useState({ enabled: Boolean(authUser.twoFactorEnabled), setupPending: false })
  const [setup, setSetup] = useState<{ manualKey: string; otpauthUrl: string } | null>(null)
  const [enableCode, setEnableCode] = useState('')
  const [disableCode, setDisableCode] = useState('')
  const [securityBusy, setSecurityBusy] = useState<'start' | 'enable' | 'disable' | ''>('')
  const [securityError, setSecurityError] = useState('')
  const [securityMessage, setSecurityMessage] = useState('')
  const [auditLogs, setAuditLogs] = useState<AuditLogItem[]>([])
  const [auditLoading, setAuditLoading] = useState(false)

  const loadAuditLogs = useCallback(async () => {
    if (!isAdmin) return
    setAuditLoading(true)
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

  useEffect(() => {
    let alive = true
    fetch('/api/auth/2fa')
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (!alive || !data) return
        setSecurity({ enabled: Boolean(data.enabled), setupPending: Boolean(data.setupPending) })
      })
      .catch(() => {})

    loadAuditLogs()
    return () => { alive = false }
  }, [loadAuditLogs])

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
      if (data.user) onUserUpdate(data.user)
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
      if (data.user) onUserUpdate(data.user)
      setSecurityMessage('تم تعطيل المصادقة الثنائية لهذا الحساب.')
      loadAuditLogs()
    } catch {
      setSecurityError('تعذر الاتصال بالخادم')
    } finally {
      setSecurityBusy('')
    }
  }

  return (
    <div className="pg">
      <SectionHeader title="الأمان والإعدادات" subtitle="المصادقة الثنائية وسجل نشاط المكتب" />

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

function BackupPage() {
  return (
    <div className="pg">
      <SectionHeader title="النسخ الاحتياطي" subtitle="هذه الميزة تحتاج ربط مزود تخزين وجدولة قبل استخدامها في الإنتاج">
        <button className="dbtn dbtn-s" disabled style={{ opacity: .65, cursor: 'not-allowed' }}>💾 غير مفعّل</button>
      </SectionHeader>
      <div className="g2">
        <div className="card">
          <div className="ct">⚙️ حالة الربط</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <SettingRow title="النسخ التلقائي" sub="غير مربوط حالياً" right={<Badge type="pe">● قيد الإعداد</Badge>} />
            <SettingRow title="مزود التخزين" sub="لم يتم اختيار مزود بعد" right={<Badge type="ur">● مطلوب</Badge>} />
            <SettingRow title="سياسة الاحتفاظ" sub="تحتاج تحديد عدد الأيام قبل التفعيل" right={<Badge type="ur">● مطلوب</Badge>} />
            <SettingRow title="التشفير" sub="سيتم تأكيده عند اختيار مزود التخزين" right={<Badge type="pe">● قيد الإعداد</Badge>} />
          </div>
        </div>
        <div className="card">
          <div className="ct">📋 السجل</div>
          <div style={{ color: '#94A3B8', fontSize: '.84rem', lineHeight: 1.9 }}>
            لا توجد نسخ احتياطية منشأة من داخل النظام حتى الآن. عند ربط التخزين والجدولة سيظهر هنا وقت كل نسخة وحجمها ونتيجة التنفيذ.
          </div>
        </div>
      </div>
    </div>
  )
}

function SettingRow({ title, sub, right, accent = 'rgba(255,255,255,.03)', border = 'transparent' }: { title: string; sub: string; right: React.ReactNode; accent?: string; border?: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: 12, background: accent, border: `1px solid ${border}`, borderRadius: 9 }}>
      <div>
        <div style={{ fontSize: '.84rem', fontWeight: 700, color: '#E2E8F0' }}>{title}</div>
        <div style={{ fontSize: '.76rem', color: '#64748B' }}>{sub}</div>
      </div>
      {right}
    </div>
  )
}

function ModalContent({
  id, close, mojService, switchPage, ctx, onSuccess, onRefresh, isAdmin,
}: {
  id: ModalId; close: () => void; mojService: string; switchPage: (id: PageId) => void
  ctx: Record<string, string>; onSuccess: () => void; onRefresh: () => void; isAdmin: boolean
}) {
  if (id === 'm-add-case') return <AddCaseModal close={close} onSuccess={onSuccess} />
  if (id === 'm-add-client') return <AddClientModal close={close} onSuccess={onSuccess} />
  if (id === 'm-add-session') return <AddSessionModal close={close} onSuccess={onSuccess} />
  if (id === 'm-add-invoice') return <AddInvoiceModal close={close} onSuccess={onSuccess} />
  if (id === 'm-edit-session') return <EditSessionModal close={close} onSuccess={onSuccess} sessionId={ctx.sessionId} />
  if (id === 'm-edit-invoice') return <EditInvoiceModal close={close} onSuccess={onSuccess} invoiceId={ctx.invoiceId} />
  if (id === 'm-compose') return <ComposeModal close={close} />
  if (id === 'm-client-detail') return <ClientDetailModal close={close} clientId={ctx.clientId} onDeleted={onSuccess} onRefresh={onRefresh} />
  if (id === 'm-case-detail') return <CaseDetailModal close={close} caseId={ctx.caseId} onDeleted={onSuccess} onRefresh={onRefresh} isAdmin={isAdmin} />
  return <MojGuideModal close={close} mojService={mojService} switchPage={switchPage} />
}

function EditSessionModal({ close, onSuccess, sessionId }: { close: () => void; onSuccess: () => void; sessionId?: string }) {
  const [loading, setLoading] = useState(true)
  const [form, setForm] = useState({ date: '', time: '', court: '', judge: '', status: 'UPCOMING', notes: '' })
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  useEffect(() => {
    if (!sessionId) { setLoading(false); return }
    fetch('/api/sessions').then(r => r.json()).then(d => {
      const s = Array.isArray(d) ? d.find((item: any) => item.id === sessionId) : null
      if (s) {
        setForm({
          date: new Date(s.date).toISOString().slice(0, 10),
          time: s.time, court: s.court, judge: s.judge ?? '', status: s.status, notes: s.notes ?? '',
        })
      }
    }).catch(() => {}).finally(() => setLoading(false))
  }, [sessionId])

  const f = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setForm(p => ({ ...p, [k]: e.target.value }))

  async function save() {
    if (!form.date || !form.time || !form.court.trim()) return setErr('التاريخ والوقت والمحكمة مطلوبة')
    setBusy(true); setErr('')
    try {
      const res = await fetch(`/api/sessions/${sessionId}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, judge: form.judge || null, notes: form.notes || null }),
      })
      if (!res.ok) { const d = await res.json(); setErr(d.error || 'خطأ في الحفظ'); return }
      onSuccess(); close()
    } catch { setErr('تعذّر الاتصال بالخادم') } finally { setBusy(false) }
  }

  async function del() {
    if (!window.confirm('هل أنت متأكد من حذف هذه الجلسة؟')) return
    setBusy(true); setErr('')
    try {
      const res = await fetch(`/api/sessions/${sessionId}`, { method: 'DELETE' })
      if (!res.ok) { const d = await res.json(); setErr(d.error || 'تعذّر الحذف'); return }
      onSuccess(); close()
    } catch { setErr('تعذّر الاتصال بالخادم') } finally { setBusy(false) }
  }

  if (loading) return <div className="mbox"><div style={{ padding: 24, textAlign: 'center', color: '#94A3B8' }}>جارٍ التحميل...</div></div>

  return (
    <div className="mbox">
      <div className="mt">✏️ تعديل الجلسة <button className="mc" onClick={close}>✕</button></div>
      <div className="fg">
        <Field label="تاريخ الجلسة"><input className="fi" type="date" value={form.date} onChange={f('date')} /></Field>
        <Field label="الوقت"><input className="fi" type="time" value={form.time} onChange={f('time')} /></Field>
        <Field label="المحكمة"><input className="fi" value={form.court} onChange={f('court')} /></Field>
        <Field label="القاضي"><input className="fi" value={form.judge} onChange={f('judge')} placeholder="اختياري" /></Field>
        <Field label="الحالة">
          <select className="fi" value={form.status} onChange={f('status')}>
            <option value="UPCOMING">قادمة</option>
            <option value="DONE">منتهية</option>
            <option value="POSTPONED">مؤجلة</option>
          </select>
        </Field>
        <Field label="ملاحظات" full><textarea className="fi" value={form.notes} onChange={f('notes')} /></Field>
      </div>
      {err && <div style={{ color: '#F87171', fontSize: '.8rem', padding: '4px 16px 8px' }}>⚠ {err}</div>}
      <div style={{ marginTop: 14, display: 'flex', gap: 8, padding: '0 16px 16px' }}>
        <button className="dbtn dbtn-p" onClick={save} disabled={busy}>{busy ? 'جارٍ الحفظ...' : '✅ حفظ التعديلات'}</button>
        <button className="dbtn dbtn-s" onClick={close}>إلغاء</button>
        <button className="dbtn dbtn-d" style={{ marginRight: 'auto' }} onClick={del} disabled={busy}>🗑️ حذف</button>
      </div>
    </div>
  )
}

function EditInvoiceModal({ close, onSuccess, invoiceId }: { close: () => void; onSuccess: () => void; invoiceId?: string }) {
  const [loading, setLoading] = useState(true)
  const [form, setForm] = useState({ amount: '', paid: '', status: 'UNPAID', dueDate: '', notes: '' })
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  useEffect(() => {
    if (!invoiceId) { setLoading(false); return }
    fetch('/api/invoices').then(r => r.json()).then(d => {
      const inv = Array.isArray(d) ? d.find((item: any) => item.id === invoiceId) : null
      if (inv) {
        setForm({
          amount: String(inv.amount), paid: String(inv.paid), status: inv.status,
          dueDate: inv.dueDate ? new Date(inv.dueDate).toISOString().slice(0, 10) : '', notes: inv.notes ?? '',
        })
      }
    }).catch(() => {}).finally(() => setLoading(false))
  }, [invoiceId])

  const f = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setForm(p => ({ ...p, [k]: e.target.value }))

  async function save() {
    const amount = Number(form.amount); const paid = Number(form.paid)
    if (!Number.isFinite(amount) || amount <= 0) return setErr('المبلغ غير صحيح')
    if (!Number.isFinite(paid) || paid < 0) return setErr('المبلغ المدفوع غير صحيح')
    if (paid > amount) return setErr('المبلغ المدفوع لا يمكن أن يتجاوز مبلغ الفاتورة')
    setBusy(true); setErr('')
    try {
      const res = await fetch(`/api/invoices/${invoiceId}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount, paid, status: form.status, dueDate: form.dueDate || null, notes: form.notes || null }),
      })
      if (!res.ok) { const d = await res.json(); setErr(d.error || 'خطأ في الحفظ'); return }
      onSuccess(); close()
    } catch { setErr('تعذّر الاتصال بالخادم') } finally { setBusy(false) }
  }

  async function del() {
    if (!window.confirm('هل أنت متأكد من حذف هذه الفاتورة؟')) return
    setBusy(true); setErr('')
    try {
      const res = await fetch(`/api/invoices/${invoiceId}`, { method: 'DELETE' })
      if (!res.ok) { const d = await res.json(); setErr(d.error || 'تعذّر الحذف'); return }
      onSuccess(); close()
    } catch { setErr('تعذّر الاتصال بالخادم') } finally { setBusy(false) }
  }

  if (loading) return <div className="mbox"><div style={{ padding: 24, textAlign: 'center', color: '#94A3B8' }}>جارٍ التحميل...</div></div>

  return (
    <div className="mbox">
      <div className="mt">✏️ تعديل الفاتورة <button className="mc" onClick={close}>✕</button></div>
      <div className="fg">
        <Field label="المبلغ (د.أ)"><input className="fi" type="number" value={form.amount} onChange={f('amount')} /></Field>
        <Field label="المبلغ المدفوع (د.أ)"><input className="fi" type="number" value={form.paid} onChange={f('paid')} /></Field>
        <Field label="الحالة">
          <select className="fi" value={form.status} onChange={f('status')}>
            <option value="UNPAID">غير مدفوعة</option>
            <option value="PARTIAL">جزئي</option>
            <option value="PAID">مدفوعة</option>
            <option value="OVERDUE">متأخرة</option>
          </select>
        </Field>
        <Field label="تاريخ الاستحقاق"><input className="fi" type="date" value={form.dueDate} onChange={f('dueDate')} /></Field>
        <Field label="ملاحظات" full><textarea className="fi" value={form.notes} onChange={f('notes')} /></Field>
      </div>
      {err && <div style={{ color: '#F87171', fontSize: '.8rem', padding: '4px 16px 8px' }}>⚠ {err}</div>}
      <div style={{ marginTop: 14, display: 'flex', gap: 8, padding: '0 16px 16px' }}>
        <button className="dbtn dbtn-p" onClick={save} disabled={busy}>{busy ? 'جارٍ الحفظ...' : '✅ حفظ التعديلات'}</button>
        <button className="dbtn dbtn-s" onClick={close}>إلغاء</button>
        <button className="dbtn dbtn-d" style={{ marginRight: 'auto' }} onClick={del} disabled={busy}>🗑️ حذف</button>
      </div>
    </div>
  )
}

function AddCaseModal({ close, onSuccess }: { close: () => void; onSuccess: () => void }) {
  const [clients, setClients] = useState<any[]>([])
  const [lawyers, setLawyers] = useState<any[]>([])
  const [form, setForm] = useState({ number: '', title: '', type: 'مدنية', clientId: '', lawyerId: '', court: '', notes: '' })
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  useEffect(() => {
    fetch('/api/clients').then(r => r.json()).then(d => { if (Array.isArray(d)) setClients(d) }).catch(() => {})
    fetch('/api/team').then(r => r.json()).then(d => { if (Array.isArray(d)) setLawyers(d) }).catch(() => {})
  }, [])

  const f = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setForm(p => ({ ...p, [k]: e.target.value }))

  async function save() {
    if (!form.number.trim()) return setErr('رقم القضية مطلوب')
    if (!form.title.trim()) return setErr('عنوان القضية مطلوب')
    if (!form.clientId) return setErr('يجب اختيار موكل')
    setBusy(true); setErr('')
    try {
      const res = await fetch('/api/cases', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, lawyerId: form.lawyerId || null }),
      })
      if (!res.ok) { const d = await res.json(); setErr(d.error || 'خطأ في الحفظ'); return }
      onSuccess()
    } catch { setErr('تعذّر الاتصال بالخادم') } finally { setBusy(false) }
  }

  return (
    <div className="mbox">
      <div className="mt">➕ قضية جديدة <button className="mc" onClick={close}>✕</button></div>
      <div className="fg">
        <Field label="رقم القضية"><input className="fi" value={form.number} onChange={f('number')} placeholder="2024/XXXX" /></Field>
        <Field label="عنوان القضية"><input className="fi" value={form.title} onChange={f('title')} placeholder="نزاع عمالي — دعوى مدنية..." /></Field>
        <Field label="نوع القضية"><select className="fi" value={form.type} onChange={f('type')}><option>مدنية</option><option>تجارية</option><option>عمالية</option><option>جنائية</option><option>أحوال شخصية</option><option>إدارية</option></select></Field>
        <Field label="الموكل">
          <select className="fi" value={form.clientId} onChange={f('clientId')}>
            <option value="">— اختر موكلاً —</option>
            {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </Field>
        <Field label="المحكمة"><input className="fi" value={form.court} onChange={f('court')} placeholder="بداية عمّان، استئناف عمّان..." /></Field>
        <Field label="المحامي المسؤول">
          <select className="fi" value={form.lawyerId} onChange={f('lawyerId')}>
            <option value="">— اختياري —</option>
            {lawyers.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
        </Field>
        <Field label="ملاحظات" full><textarea className="fi" value={form.notes} onChange={f('notes')} placeholder="وصف موجز للقضية..." /></Field>
      </div>
      {err && <div style={{ color: '#F87171', fontSize: '.8rem', padding: '4px 16px 8px' }}>⚠ {err}</div>}
      <div style={{ marginTop: 14, display: 'flex', gap: 8, padding: '0 16px 16px' }}>
        <button className="dbtn dbtn-p" onClick={save} disabled={busy}>{busy ? 'جارٍ الحفظ...' : '✅ إنشاء القضية'}</button>
        <button className="dbtn dbtn-s" onClick={close}>إلغاء</button>
      </div>
    </div>
  )
}

function AddClientModal({ close, onSuccess }: { close: () => void; onSuccess: () => void }) {
  const [form, setForm] = useState({ name: '', phone: '', email: '', idNumber: '', address: '' })
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  const f = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setForm(p => ({ ...p, [k]: e.target.value }))

  async function save() {
    if (!form.name.trim()) return setErr('اسم العميل مطلوب')
    setBusy(true); setErr('')
    try {
      const res = await fetch('/api/clients', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })
      if (!res.ok) { const d = await res.json(); setErr(d.error || 'خطأ في الحفظ'); return }
      onSuccess()
    } catch { setErr('تعذّر الاتصال بالخادم') } finally { setBusy(false) }
  }

  return (
    <div className="mbox">
      <div className="mt">➕ عميل جديد <button className="mc" onClick={close}>✕</button></div>
      <div className="fg">
        <Field label="اسم العميل / الشركة"><input className="fi" value={form.name} onChange={f('name')} placeholder="الاسم الكامل" /></Field>
        <Field label="رقم الهاتف"><input className="fi" value={form.phone} onChange={f('phone')} placeholder="07X XXXX XXXX" /></Field>
        <Field label="البريد الإلكتروني"><input className="fi" type="email" value={form.email} onChange={f('email')} placeholder="email@domain.com" /></Field>
        <Field label="رقم الهوية / السجل التجاري"><input className="fi" value={form.idNumber} onChange={f('idNumber')} placeholder="XXXXXXXXX" /></Field>
        <Field label="العنوان" full><input className="fi" value={form.address} onChange={f('address')} placeholder="عمّان، شارع..." /></Field>
      </div>
      {err && <div style={{ color: '#F87171', fontSize: '.8rem', padding: '4px 16px 8px' }}>⚠ {err}</div>}
      <div style={{ marginTop: 14, display: 'flex', gap: 8, padding: '0 16px 16px' }}>
        <button className="dbtn dbtn-p" onClick={save} disabled={busy}>{busy ? 'جارٍ الحفظ...' : '✅ إضافة العميل'}</button>
        <button className="dbtn dbtn-s" onClick={close}>إلغاء</button>
      </div>
    </div>
  )
}

function AddSessionModal({ close, onSuccess }: { close: () => void; onSuccess: () => void }) {
  const [cases, setCases] = useState<any[]>([])
  const [form, setForm] = useState({ caseId: '', date: '', time: '09:30', court: '', judge: '', notes: '' })
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  useEffect(() => {
    fetch('/api/cases').then(r => r.json()).then(d => { if (Array.isArray(d)) setCases(d) }).catch(() => {})
  }, [])

  const f = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setForm(p => ({ ...p, [k]: e.target.value }))

  async function save() {
    if (!form.caseId) return setErr('يجب اختيار القضية')
    if (!form.date) return setErr('تاريخ الجلسة مطلوب')
    setBusy(true); setErr('')
    try {
      const res = await fetch('/api/sessions', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, judge: form.judge || null, notes: form.notes || null }),
      })
      if (!res.ok) { const d = await res.json(); setErr(d.error || 'خطأ في الحفظ'); return }
      onSuccess()
    } catch { setErr('تعذّر الاتصال بالخادم') } finally { setBusy(false) }
  }

  return (
    <div className="mbox">
      <div className="mt">📅 جلسة جديدة <button className="mc" onClick={close}>✕</button></div>
      <div className="fg">
        <Field label="القضية" full>
          <select className="fi" value={form.caseId} onChange={f('caseId')}>
            <option value="">— اختر القضية —</option>
            {cases.map(c => <option key={c.id} value={c.id}>{c.number} — {c.title}</option>)}
          </select>
        </Field>
        <Field label="تاريخ الجلسة"><input className="fi" type="date" value={form.date} onChange={f('date')} /></Field>
        <Field label="الوقت"><input className="fi" type="time" value={form.time} onChange={f('time')} /></Field>
        <Field label="المحكمة"><input className="fi" value={form.court} onChange={f('court')} placeholder="بداية عمّان، استئناف عمّان..." /></Field>
        <Field label="القاضي"><input className="fi" value={form.judge} onChange={f('judge')} placeholder="اسم القاضي (اختياري)" /></Field>
        <Field label="ملاحظات" full><textarea className="fi" value={form.notes} onChange={f('notes')} placeholder="ملاحظات إضافية..." /></Field>
      </div>
      {err && <div style={{ color: '#F87171', fontSize: '.8rem', padding: '4px 16px 8px' }}>⚠ {err}</div>}
      <div style={{ marginTop: 14, display: 'flex', gap: 8, padding: '0 16px 16px' }}>
        <button className="dbtn dbtn-p" onClick={save} disabled={busy}>{busy ? 'جارٍ الحفظ...' : '✅ حفظ الجلسة'}</button>
        <button className="dbtn dbtn-s" onClick={close}>إلغاء</button>
      </div>
    </div>
  )
}

function AddInvoiceModal({ close, onSuccess }: { close: () => void; onSuccess: () => void }) {
  const [clients, setClients] = useState<any[]>([])
  const [cases, setCases] = useState<any[]>([])
  const [form, setForm] = useState({ number: '', clientId: '', caseId: '', notes: '', amount: '', dueDate: '' })
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  useEffect(() => {
    fetch('/api/clients').then(r => r.json()).then(d => { if (Array.isArray(d)) setClients(d) }).catch(() => {})
    fetch('/api/cases').then(r => r.json()).then(d => { if (Array.isArray(d)) setCases(d) }).catch(() => {})
  }, [])

  const f = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setForm(p => ({ ...p, [k]: e.target.value }))

  const clientCases = cases.filter(c => !form.clientId || c.clientId === form.clientId)

  async function save() {
    if (!form.clientId) return setErr('يجب اختيار العميل')
    if (!form.amount || isNaN(Number(form.amount)) || Number(form.amount) <= 0) return setErr('المبلغ غير صحيح')
    setBusy(true); setErr('')
    const number = form.number.trim() || `INV-${Date.now()}`
    try {
      const res = await fetch('/api/invoices', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, number, amount: Number(form.amount), caseId: form.caseId || null, dueDate: form.dueDate || null, notes: form.notes || null }),
      })
      if (!res.ok) { const d = await res.json(); setErr(d.error || 'خطأ في الحفظ'); return }
      onSuccess()
    } catch { setErr('تعذّر الاتصال بالخادم') } finally { setBusy(false) }
  }

  return (
    <div className="mbox">
      <div className="mt">🧾 فاتورة جديدة <button className="mc" onClick={close}>✕</button></div>
      <div className="fg">
        <Field label="رقم الفاتورة"><input className="fi" value={form.number} onChange={f('number')} placeholder="INV-2024-XXX (يُولَّد تلقائياً)" /></Field>
        <Field label="العميل">
          <select className="fi" value={form.clientId} onChange={e => { setForm(p => ({ ...p, clientId: e.target.value, caseId: '' })) }}>
            <option value="">— اختر العميل —</option>
            {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </Field>
        <Field label="القضية (اختياري)">
          <select className="fi" value={form.caseId} onChange={f('caseId')}>
            <option value="">—</option>
            {clientCases.map(c => <option key={c.id} value={c.id}>{c.number} — {c.title}</option>)}
          </select>
        </Field>
        <Field label="وصف الخدمة" full><input className="fi" value={form.notes} onChange={f('notes')} placeholder="أتعاب قانونية — جلسة مرافعة" /></Field>
        <Field label="المبلغ (د.أ)"><input className="fi" type="number" value={form.amount} onChange={f('amount')} placeholder="0.000" /></Field>
        <Field label="تاريخ الاستحقاق"><input className="fi" type="date" value={form.dueDate} onChange={f('dueDate')} /></Field>
      </div>
      {err && <div style={{ color: '#F87171', fontSize: '.8rem', padding: '4px 16px 8px' }}>⚠ {err}</div>}
      <div style={{ marginTop: 14, display: 'flex', gap: 8, padding: '0 16px 16px' }}>
        <button className="dbtn dbtn-p" onClick={save} disabled={busy}>{busy ? 'جارٍ الحفظ...' : '✅ إصدار الفاتورة'}</button>
        <button className="dbtn dbtn-s" onClick={close}>إلغاء</button>
      </div>
    </div>
  )
}

function ComposeModal({ close }: { close: () => void }) {
  return (
    <div className="mbox">
      <div className="mt">✉️ رسالة جديدة <button className="mc" onClick={close}>✕</button></div>
      <div className="fg">
        <Field label="إلى" full><input className="fi" placeholder="البريد الإلكتروني" /></Field>
        <Field label="الموضوع" full><input className="fi" placeholder="موضوع الرسالة" /></Field>
        <Field label="الرسالة" full><textarea className="fi" style={{ minHeight: 100 }} /></Field>
      </div>
      <div style={{ marginTop: 14, display: 'flex', gap: 8 }}>
        <button className="dbtn dbtn-p" onClick={() => { close(); window.alert('تم الإرسال') }}>📤 إرسال</button>
        <button className="dbtn dbtn-s" onClick={close}>إلغاء</button>
      </div>
    </div>
  )
}


function ClientDetailModal({ close, clientId, onDeleted, onRefresh }: { close: () => void; clientId?: string; onDeleted: () => void; onRefresh: () => void }) {
  const [tab, setTab] = useState<'data' | 'cases' | 'invoices' | 'account'>('data')
  const [client, setClient] = useState<any>(null)
  const [loading, setLoading] = useState(true)
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
    if (!clientId) { setLoading(false); return }
    setLoading(true)
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
      onRefresh()
    } catch { setEditErr('تعذّر الاتصال بالخادم') } finally { setEditBusy(false) }
  }

  async function deactivate() {
    if (!window.confirm('هل أنت متأكد من إلغاء تفعيل هذا العميل؟ لن يظهر بعدها في القوائم.')) return
    setEditBusy(true); setEditErr('')
    try {
      const res = await fetch(`/api/clients/${clientId}`, { method: 'DELETE' })
      if (!res.ok) { const d = await res.json(); setEditErr(d.error || 'تعذّر إلغاء التفعيل'); return }
      onDeleted()
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
    <div className="mbox">
      <div className="mt">👤 {loading ? 'جارٍ التحميل...' : (client?.name ?? 'العميل')} <button className="mc" onClick={close}>✕</button></div>
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

function CaseDetailModal({ close, caseId, onDeleted, onRefresh, isAdmin }: { close: () => void; caseId?: string; onDeleted: () => void; onRefresh: () => void; isAdmin: boolean }) {
  const [tab, setTab] = useState<'details' | 'sessions' | 'files'>('details')
  const [c, setC] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState(false)
  const [lawyers, setLawyers] = useState<any[]>([])
  const [editForm, setEditForm] = useState({ number: '', title: '', type: '', court: '', notes: '', status: 'ACTIVE', lawyerId: '' })
  const [editBusy, setEditBusy] = useState(false)
  const [editErr, setEditErr] = useState('')

  const loadCase = useCallback(() => {
    if (!caseId) { setLoading(false); return }
    setLoading(true)
    fetch(`/api/cases/${caseId}`).then(r => r.json()).then(d => {
      setC(d)
      setEditForm({
        number: d.number ?? '', title: d.title ?? '', type: d.type ?? '', court: d.court ?? '',
        notes: d.notes ?? '', status: d.status ?? 'ACTIVE', lawyerId: d.lawyer?.id ?? '',
      })
    }).catch(() => {}).finally(() => setLoading(false))
  }, [caseId])
  useEffect(() => { loadCase() }, [loadCase])
  useEffect(() => {
    if (!isAdmin) return
    fetch('/api/team').then(r => r.json()).then(d => { if (Array.isArray(d)) setLawyers(d) }).catch(() => {})
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
      loadCase()
      onRefresh()
    } catch { setEditErr('تعذّر الاتصال بالخادم') } finally { setEditBusy(false) }
  }

  async function del() {
    if (!window.confirm('هل أنت متأكد من حذف هذه القضية؟ سيتم حذف جلساتها وفواتيرها ومستنداتها المرتبطة.')) return
    setEditBusy(true); setEditErr('')
    try {
      const res = await fetch(`/api/cases/${caseId}`, { method: 'DELETE' })
      if (!res.ok) { const d = await res.json(); setEditErr(d.error || 'تعذّر الحذف'); return }
      onDeleted()
    } catch { setEditErr('تعذّر الاتصال بالخادم') } finally { setEditBusy(false) }
  }

  const nextSession = c?.sessions?.find((s: any) => s.status === 'UPCOMING')

  return (
    <div className="mbox" style={{ width: 600 }}>
      <div className="mt">⚖️ {loading ? 'جارٍ التحميل...' : (c ? `${c.number} — ${c.title}` : 'القضية')} <button className="mc" onClick={close}>✕</button></div>
      <div className="tabs">
        <TabButton active={tab === 'details'} onClick={() => setTab('details')}>التفاصيل</TabButton>
        <TabButton active={tab === 'sessions'} onClick={() => setTab('sessions')}>الجلسات</TabButton>
        <TabButton active={tab === 'files'} onClick={() => setTab('files')}>الملفات</TabButton>
      </div>
      {loading ? <div style={{ padding: 24, color: '#94A3B8', textAlign: 'center' }}>جارٍ التحميل...</div> : !c ? <div style={{ padding: 24, color: '#F87171', textAlign: 'center' }}>تعذّر تحميل البيانات</div> : (
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

function MojGuideModal({ close, mojService, switchPage }: { close: () => void; mojService: string; switchPage: (id: PageId) => void }) {
  return (
    <div className="mbox">
      <div className="mt">🏛️ {mojService} — دليل الاستخدام <button className="mc" onClick={close}>✕</button></div>
      <div style={{ fontSize: '.84rem', color: '#CBD5E1', lineHeight: 1.8 }}>
        <div style={{ background: 'rgba(212,175,55,.07)', border: '1px solid rgba(212,175,55,.15)', borderRadius: 9, padding: 12, marginBottom: 14 }}>
          <b>الخطوات المطلوبة:</b>
          <ol style={{ marginTop: 8, paddingRight: 18, lineHeight: 2 }}>
            <li>سجّل الدخول على services.moj.gov.jo ببيانات نقابة المحامين.</li>
            <li>انتقل إلى قسم "{mojService}".</li>
            <li>أدخل رقم القضية أو الطلب.</li>
            <li>أرفق المستندات المطلوبة بصيغة PDF.</li>
            <li>أرسل الطلب واحتفظ برقم المتابعة.</li>
          </ol>
        </div>
        <div style={{ fontSize: '.78rem', color: '#94A3B8' }}>💡 يمكن للمساعد الذكي مساعدتك في تجهيز المستندات المطلوبة لهذه الخدمة.</div>
        <div style={{ marginTop: 12, display: 'flex', gap: 8 }}>
          <a href="https://services.moj.gov.jo" target="_blank" className="dbtn dbtn-p" style={{ textDecoration: 'none' }}>🔗 فتح البوابة</a>
          <button className="dbtn dbtn-s" onClick={() => { close(); switchPage('ai-assistant') }}>🤖 اسأل المساعد</button>
        </div>
      </div>
    </div>
  )
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return <button className={`tb${active ? ' active' : ''}`} onClick={onClick}>{children}</button>
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return <div className="arr"><span className="lb">{label}</span><span className="vl">{value}</span></div>
}

function InfoLine({ text, badge }: { text: string; badge?: React.ReactNode }) {
  return (
    <div style={{ fontSize: '.8rem', color: '#CBD5E1', padding: 8, background: 'rgba(255,255,255,.03)', borderRadius: 8, marginBottom: 6, display: 'flex', justifyContent: 'space-between', gap: 8 }}>
      <span>{text}</span>
      {badge}
    </div>
  )
}

function TimelineItem({ date, text, color }: { date: string; text: string; color: string }) {
  return (
    <div className="tli">
      <div className="tld" style={{ background: color }} />
      <div className="tdate">{date}</div>
      <div className="ttxt">{text}</div>
    </div>
  )
}

interface AuthUser {
  id: string
  name: string
  email: string
  role: 'OFFICE_MANAGER' | 'LAWYER' | 'CITIZEN'
  officeId: string
  officeName: string | null
  barNumber: string | null
  clientId?: string | null
  isPlatformAdmin?: boolean
  twoFactorEnabled?: boolean
}

type OpenModal = (id: ModalId, ctx?: Record<string, string>) => void

export default function DashboardPage() {
  const [loggedIn, setLoggedIn] = useState(false)
  const [authChecking, setAuthChecking] = useState(true)
  const [authMode, setAuthMode] = useState<'login' | 'signup' | '2fa' | 'forgot' | 'reset'>('login')
  const [loginBusy, setLoginBusy] = useState(false)
  const [signupBusy, setSignupBusy] = useState(false)
  const [twoFactorBusy, setTwoFactorBusy] = useState(false)
  const [twoFactorCode, setTwoFactorCode] = useState('')
  const [twoFactorUser, setTwoFactorUser] = useState<{ email: string; name?: string } | null>(null)
  const [loginError, setLoginError] = useState('')
  const [forgotEmail, setForgotEmail] = useState('')
  const [forgotBusy, setForgotBusy] = useState(false)
  const [forgotSent, setForgotSent] = useState(false)
  const [resetToken, setResetToken] = useState('')
  const [resetPassword, setResetPassword] = useState('')
  const [resetConfirm, setResetConfirm] = useState('')
  const [resetBusy, setResetBusy] = useState(false)
  const [resetDone, setResetDone] = useState(false)
  const [signupForm, setSignupForm] = useState({ name: '', officeName: '', email: '', password: '', phone: '', barNumber: '' })
  const [authUser, setAuthUser] = useState<AuthUser | null>(null)
  const [page, setPage] = useState<PageId>('dash')
  const [openModalId, setOpenModalId] = useState<ModalId | null>(null)
  const [modalCtx, setModalCtx] = useState<Record<string, string>>({})
  const [refreshKey, setRefreshKey] = useState(0)
  const [sidebarCounts, setSidebarCounts] = useState({ cases: 0, sessions: 0, notifs: 0 })
  const [mojService, setMojService] = useState('دليل الخدمة')
  const emailRef = useRef<HTMLInputElement>(null)
  const passwordRef = useRef<HTMLInputElement>(null)
  const mainRef = useRef<HTMLDivElement | null>(null)

  const userRole = authUser?.role === 'OFFICE_MANAGER' ? 'admin' : 'lawyer'

  const navSections = useMemo(() => {
    const base = BASE_NAV.map(section => ({
      ...section,
      items: section.items.map(item => {
        if (item.id === 'cases' && sidebarCounts.cases > 0) return { ...item, badge: String(sidebarCounts.cases) }
        if (item.id === 'sessions' && sidebarCounts.sessions > 0) return { ...item, badge: String(sidebarCounts.sessions) }
        if (item.id === 'notifications' && sidebarCounts.notifs > 0) return { ...item, badge: String(sidebarCounts.notifs) }
        return item
      }),
    }))
    return userRole === 'admin' ? [...base, ADMIN_NAV] : base
  }, [userRole, sidebarCounts])

  const activeTitle = titles[page]

  useEffect(() => {
    let alive = true

    const urlResetToken = new URLSearchParams(window.location.search).get('resetToken')
    if (urlResetToken) {
      setResetToken(urlResetToken)
      setAuthMode('reset')
      window.history.replaceState({}, '', window.location.pathname)
      setAuthChecking(false)
      return () => { alive = false }
    }

    fetch('/api/auth/me')
      .then(async (res) => {
        if (!alive || !res.ok) return
        const data = await res.json()
        if (data.user?.role === 'CITIZEN') {
          window.location.href = '/citizen'
          return
        }
        if (data.user) {
          setAuthUser(data.user)
          setLoggedIn(true)
        }
      })
      .catch(() => {})
      .finally(() => {
        if (alive) setAuthChecking(false)
      })

    return () => { alive = false }
  }, [])

  useEffect(() => {
    if (!loggedIn) return
    Promise.all([
      fetch('/api/dashboard').then(r => r.json()).catch(() => null),
      fetch('/api/notifications').then(r => r.json()).catch(() => []),
    ]).then(([dash, notifs]) => {
      setSidebarCounts({
        cases: dash?.stats?.activeCases ?? 0,
        sessions: dash?.stats?.upcomingSessions ?? 0,
        notifs: Array.isArray(notifs) ? notifs.filter((n: any) => !n.read).length : 0,
      })
    })
  }, [loggedIn, refreshKey])

  const openModal: OpenModal = (id, ctx = {}) => {
    setOpenModalId(id)
    setModalCtx(ctx)
  }

  const switchPage = (id: PageId) => {
    setPage(id)
    mainRef.current?.scrollTo({ top: 0 })
  }

  const login = async () => {
    const email = emailRef.current?.value?.trim()
    const password = passwordRef.current?.value
    if (!email || !password) { setLoginError('أدخل البريد وكلمة المرور'); return }
    setLoginBusy(true)
    setLoginError('')
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      })
      const data = await res.json()
      if (!res.ok) { setLoginError(data.error || 'خطأ في الدخول'); return }
      if (data.requires2FA) {
        setTwoFactorUser(data.user ?? { email })
        setTwoFactorCode('')
        setAuthMode('2fa')
        return
      }
      if (data.user?.role === 'CITIZEN') { window.location.href = '/citizen'; return }
      setAuthUser(data.user)
      setLoggedIn(true)
    } catch {
      setLoginError('تعذّر الاتصال بالخادم')
    } finally {
      setLoginBusy(false)
    }
  }

  const verifyTwoFactor = async () => {
    if (!twoFactorCode.trim()) { setLoginError('أدخل رمز التحقق'); return }
    setTwoFactorBusy(true)
    setLoginError('')
    try {
      const res = await fetch('/api/auth/2fa/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: twoFactorCode.trim() }),
      })
      const data = await res.json()
      if (!res.ok) { setLoginError(data.error || 'رمز التحقق غير صحيح'); return }
      if (data.user?.role === 'CITIZEN') { window.location.href = '/citizen'; return }
      setAuthUser(data.user)
      setLoggedIn(true)
      setAuthMode('login')
      setTwoFactorCode('')
      setTwoFactorUser(null)
    } catch {
      setLoginError('تعذّر الاتصال بالخادم')
    } finally {
      setTwoFactorBusy(false)
    }
  }

  const updateSignup = (key: keyof typeof signupForm) => (e: React.ChangeEvent<HTMLInputElement>) => {
    setSignupForm((form) => ({ ...form, [key]: e.target.value }))
  }

  const signup = async () => {
    if (!signupForm.name.trim()) { setLoginError('أدخل الاسم الكامل'); return }
    if (!signupForm.email.trim() || !signupForm.email.includes('@')) { setLoginError('أدخل بريداً إلكترونياً صحيحاً'); return }
    if (signupForm.password.length < 8) { setLoginError('كلمة المرور يجب أن تكون 8 أحرف على الأقل'); return }

    setSignupBusy(true)
    setLoginError('')
    try {
      const res = await fetch('/api/auth/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...signupForm,
          email: signupForm.email.toLowerCase().trim(),
          officeName: signupForm.officeName.trim(),
        }),
      })
      const data = await res.json()
      if (!res.ok) { setLoginError(data.error || 'تعذر إنشاء الحساب'); return }
      setAuthUser(data.user)
      setLoggedIn(true)
    } catch {
      setLoginError('تعذّر الاتصال بالخادم')
    } finally {
      setSignupBusy(false)
    }
  }

  const requestReset = async () => {
    if (!forgotEmail.trim() || !forgotEmail.includes('@')) { setLoginError('أدخل بريداً إلكترونياً صحيحاً'); return }
    setForgotBusy(true); setLoginError('')
    try {
      const res = await fetch('/api/auth/forgot-password', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: forgotEmail.trim() }),
      })
      const data = await res.json()
      if (!res.ok) { setLoginError(data.error || 'تعذر إرسال الطلب'); return }
      setForgotSent(true)
    } catch {
      setLoginError('تعذّر الاتصال بالخادم')
    } finally {
      setForgotBusy(false)
    }
  }

  const submitReset = async () => {
    if (resetPassword.length < 8) { setLoginError('كلمة المرور يجب أن تكون 8 أحرف على الأقل'); return }
    if (resetPassword !== resetConfirm) { setLoginError('كلمتا المرور غير متطابقتين'); return }
    setResetBusy(true); setLoginError('')
    try {
      const res = await fetch('/api/auth/reset-password', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: resetToken, password: resetPassword }),
      })
      const data = await res.json()
      if (!res.ok) { setLoginError(data.error || 'تعذر إعادة تعيين كلمة المرور'); return }
      setResetDone(true)
    } catch {
      setLoginError('تعذّر الاتصال بالخادم')
    } finally {
      setResetBusy(false)
    }
  }

  const logout = async () => {
    await fetch('/api/auth/logout', { method: 'POST' })
    setLoggedIn(false)
    setAuthUser(null)
    setAuthMode('login')
    setTwoFactorCode('')
    setTwoFactorUser(null)
  }

  const closeModal = () => { setOpenModalId(null); setModalCtx({}) }

  const notifyRefresh = () => { setRefreshKey(k => k + 1); closeModal() }
  const bumpRefresh = () => setRefreshKey(k => k + 1)

  const openMojGuide = (service: string) => {
    setMojService(service)
    openModal('m-moj-guide')
  }

  return (
    <div id="dboard-body">
      {authChecking && (
        <div id="login-screen">
          <div className="lcard">
            <div className="llogo">
              <div className="brand">دُسْتُورِي</div>
              <div className="sub">جارٍ التحقق من الجلسة...</div>
            </div>
          </div>
        </div>
      )}

      {!authChecking && !loggedIn && (
        <div id="login-screen">
          <div className="lcard">
            <div className="llogo">
              <div className="brand">دُسْتُورِي</div>
              <div className="sub">
                {authMode === 'login' ? 'منظومة المحامي الذكي'
                  : authMode === 'signup' ? 'إنشاء مكتب جديد'
                  : authMode === 'forgot' ? 'استعادة كلمة المرور'
                  : authMode === 'reset' ? 'تعيين كلمة مرور جديدة'
                  : 'رمز المصادقة الثنائية'}
              </div>
            </div>

            {authMode === 'forgot' ? (
              forgotSent ? (
                <div style={{ color: '#10B981', fontSize: '.85rem', textAlign: 'center', lineHeight: 1.8, padding: '10px 0' }}>
                  ✅ إذا كان هذا البريد مسجلاً لدينا، سيصلك رابط لإعادة تعيين كلمة المرور خلال دقائق. تحقق من صندوق الوارد.
                </div>
              ) : (
                <div className="lf">
                  <label>البريد الإلكتروني</label>
                  <input type="email" value={forgotEmail} onChange={(e) => setForgotEmail(e.target.value)} placeholder="example@lawfirm.jo" autoComplete="username" onKeyDown={(e) => e.key === 'Enter' && requestReset()} />
                </div>
              )
            ) : authMode === 'reset' ? (
              resetDone ? (
                <div style={{ color: '#10B981', fontSize: '.85rem', textAlign: 'center', lineHeight: 1.8, padding: '10px 0' }}>
                  ✅ تم تعيين كلمة المرور الجديدة بنجاح. يمكنك الآن تسجيل الدخول بها.
                </div>
              ) : (
                <>
                  <div className="lf">
                    <label>كلمة المرور الجديدة</label>
                    <input type="password" value={resetPassword} onChange={(e) => setResetPassword(e.target.value)} placeholder="8 أحرف على الأقل" autoComplete="new-password" />
                  </div>
                  <div className="lf">
                    <label>تأكيد كلمة المرور</label>
                    <input type="password" value={resetConfirm} onChange={(e) => setResetConfirm(e.target.value)} placeholder="أعد كتابة كلمة المرور" autoComplete="new-password" onKeyDown={(e) => e.key === 'Enter' && submitReset()} />
                  </div>
                </>
              )
            ) : authMode === 'login' ? (
              <>
                <div className="lf">
                  <label>البريد الإلكتروني</label>
                  <input ref={emailRef} type="email" placeholder="example@lawfirm.jo" autoComplete="username" />
                </div>
                <div className="lf">
                  <label>كلمة المرور</label>
                  <input ref={passwordRef} type="password" placeholder="••••••••••" autoComplete="current-password" onKeyDown={(e) => e.key === 'Enter' && login()} />
                </div>
                <button
                  type="button"
                  onClick={() => { setLoginError(''); setForgotSent(false); setAuthMode('forgot') }}
                  style={{ marginTop: -6, marginBottom: 10, background: 'none', border: 'none', color: '#94A3B8', fontFamily: "'Cairo', sans-serif", fontSize: '.76rem', fontWeight: 700, cursor: 'pointer', textAlign: 'left', width: '100%' }}
                >
                  نسيت كلمة المرور؟
                </button>
              </>
            ) : authMode === 'signup' ? (
              <>
                <div className="lf">
                  <label>الاسم الكامل</label>
                  <input value={signupForm.name} onChange={updateSignup('name')} placeholder="اسم المحامي / المدير" autoComplete="name" />
                </div>
                <div className="lf">
                  <label>اسم المكتب</label>
                  <input value={signupForm.officeName} onChange={updateSignup('officeName')} placeholder="اختياري للمحامي المستقل" />
                </div>
                <div className="lf">
                  <label>البريد الإلكتروني</label>
                  <input value={signupForm.email} onChange={updateSignup('email')} type="email" placeholder="example@lawfirm.jo" autoComplete="username" />
                </div>
                <div className="lf">
                  <label>كلمة المرور</label>
                  <input value={signupForm.password} onChange={updateSignup('password')} type="password" placeholder="8 أحرف على الأقل" autoComplete="new-password" onKeyDown={(e) => e.key === 'Enter' && signup()} />
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                  <div className="lf">
                    <label>الهاتف</label>
                    <input value={signupForm.phone} onChange={updateSignup('phone')} placeholder="اختياري" />
                  </div>
                  <div className="lf">
                    <label>رقم النقابة</label>
                    <input value={signupForm.barNumber} onChange={updateSignup('barNumber')} placeholder="اختياري" />
                  </div>
                </div>
              </>
            ) : (
              <>
                <div style={{ color: '#94A3B8', fontSize: '.82rem', textAlign: 'center', lineHeight: 1.7, marginBottom: 14 }}>
                  أدخل الرمز من تطبيق المصادقة لحساب {twoFactorUser?.email ?? 'المستخدم'}.
                </div>
                <div className="lf">
                  <label>رمز التحقق</label>
                  <input value={twoFactorCode} onChange={(e) => setTwoFactorCode(e.target.value)} inputMode="numeric" maxLength={6} placeholder="123456" autoComplete="one-time-code" onKeyDown={(e) => e.key === 'Enter' && verifyTwoFactor()} />
                </div>
              </>
            )}

            {loginError && <div style={{ color: '#EF4444', fontSize: 13, textAlign: 'center', marginBottom: 4 }}>{loginError}</div>}

            {authMode === 'forgot' ? (
              !forgotSent && (
                <button className="btn-login" onClick={requestReset} disabled={forgotBusy}>{forgotBusy ? 'جارٍ الإرسال...' : 'إرسال رابط إعادة التعيين'}</button>
              )
            ) : authMode === 'reset' ? (
              !resetDone && (
                <button className="btn-login" onClick={submitReset} disabled={resetBusy}>{resetBusy ? 'جارٍ الحفظ...' : 'حفظ كلمة المرور الجديدة'}</button>
              )
            ) : (
              <button className="btn-login" onClick={authMode === 'login' ? login : authMode === 'signup' ? signup : verifyTwoFactor} disabled={authMode === 'login' ? loginBusy : authMode === 'signup' ? signupBusy : twoFactorBusy}>
                {authMode === 'login'
                  ? (loginBusy ? 'جارٍ التحقق...' : 'دخول إلى لوحة التحكم')
                  : authMode === 'signup'
                    ? (signupBusy ? 'جارٍ إنشاء المكتب...' : 'إنشاء المكتب والدخول')
                    : (twoFactorBusy ? 'جارٍ التحقق...' : 'تأكيد الرمز')}
              </button>
            )}

            <button
              type="button"
              onClick={() => {
                setLoginError('')
                setTwoFactorCode('')
                setTwoFactorUser(null)
                setForgotSent(false)
                setResetDone(false)
                setAuthMode(authMode === 'forgot' || authMode === 'reset' ? 'login' : authMode === 'login' ? 'signup' : 'login')
              }}
              style={{ marginTop: 10, background: 'none', border: 'none', color: '#D4AF37', fontFamily: "'Cairo', sans-serif", fontSize: '.8rem', fontWeight: 800, cursor: 'pointer', width: '100%' }}
            >
              {authMode === 'login' ? 'إنشاء مكتب جديد'
                : authMode === 'signup' ? 'لدي حساب بالفعل'
                : authMode === 'forgot' || authMode === 'reset' ? 'الرجوع لتسجيل الدخول'
                : 'الرجوع لتسجيل الدخول'}
            </button>
            <div className="lhint">
              دُسْتُورِي · {authMode === 'login' ? 'منظومة المحامي الذكي'
                : authMode === 'signup' ? 'كل تسجيل جديد ينشئ مكتباً مستقلاً'
                : authMode === 'forgot' ? 'سيصلك رابط عبر البريد الإلكتروني'
                : authMode === 'reset' ? 'الرابط صالح لمدة 30 دقيقة من طلبه'
                : 'جلسة التحقق صالحة لمدة 10 دقائق'}
            </div>
          </div>
        </div>
      )}

      {!authChecking && loggedIn && (
        <div id="app">
          <aside id="sb">
            <div className="sb-logo">
              <div className="brand">دُسْتُورِي</div>
              <div className="sub">{userRole === 'admin' ? 'لوحة تحكم مدير المكتب' : 'لوحة تحكم المحامي'}</div>
            </div>
            <div className="lcard2">
              <div className="av">{authUser?.name?.[0] ?? 'م'}</div>
              <div>
                <div className="li-name">{authUser?.name ?? ''}</div>
                <div className="li-role">{authUser?.officeName ?? 'مكتب مستقل'}</div>
                <div className="li-role">{userRole === 'admin' ? 'مدير المكتب — صلاحيات كاملة' : 'محامٍ'}</div>
                <span className="li-badge">{userRole === 'admin' ? 'صلاحيات كاملة' : authUser?.barNumber ? `نقابة # ${authUser.barNumber}` : 'محامٍ'}</span>
              </div>
            </div>

            {navSections.map((section) => (
              <div key={section.label}>
                <div className="nl">{section.label}</div>
                {section.items.map((item) => (
                    <button key={item.id} className={`ni${page === item.id ? ' active' : ''}`} type="button" onClick={() => switchPage(item.id)}>
                      <span className="ic">{item.icon}</span>
                      {item.label}
                      {item.badge && <span className="bc">{item.badge}</span>}
                    </button>
                  ))}
              </div>
            ))}

            <div className="sb-foot">
              <button className="btn-out" onClick={logout}>
                ⬅ تسجيل الخروج
              </button>
            </div>
          </aside>

          <main id="main" ref={mainRef}>
            <div className="tph">
              <div className="tph-title">{activeTitle}</div>
              <div className="tph-ax">
                <button className="ic-btn" onClick={() => switchPage('notifications')} aria-label="الإشعارات">
                  🔔<span className="dot" />
                </button>
                <button className="ic-btn" onClick={() => switchPage('ai-assistant')} aria-label="المساعد القانوني">
                  🤖
                </button>
                <button className="dbtn dbtn-p" onClick={() => openModal('m-add-case')} style={{ height: 32, fontSize: '.76rem' }}>
                  + قضية جديدة
                </button>
              </div>
            </div>

            {page === 'dash' && <DashboardHome openModal={openModal} switchPage={switchPage} authUser={authUser} />}
            {page === 'clients' && <ClientsPage openModal={openModal} refreshKey={refreshKey} />}
            {page === 'cases' && <CasesPage openModal={openModal} refreshKey={refreshKey} />}
            {page === 'sessions' && <SessionsPage openModal={openModal} refreshKey={refreshKey} />}
            {page === 'invoices' && <InvoicesPage openModal={openModal} refreshKey={refreshKey} />}
            {page === 'team' && (userRole === 'admin' ? <TeamPage /> : (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: 340, gap: 12, color: '#64748B', textAlign: 'center', padding: 40 }}>
                <div style={{ fontSize: '3rem' }}>🔒</div>
                <div style={{ fontSize: '1.1rem', fontWeight: 800, color: '#94A3B8' }}>صلاحية محدودة</div>
                <div style={{ fontSize: '.85rem', maxWidth: 320, lineHeight: 1.8 }}>إدارة الفريق متاحة لمدير المكتب فقط. تواصل مع المدير إذا كنت تحتاج للوصول.</div>
              </div>
            ))}
            {page === 'timelog' && <TimeLogPage />}
            {page === 'calendar' && <CalendarPage />}
            {page === 'ai-contract' && <AiContractPage switchPage={switchPage} />}
            {page === 'ai-write' && <AiWritePage />}
            {page === 'ai-assistant' && <AiAssistantPage />}
            {page === 'ai-case' && <AiCasePage />}
            {page === 'docs' && <DocumentsPage />}
            {page === 'file-search' && <FileSearchPage />}
            {page === 'ocr' && <OcrPage switchPage={switchPage} />}
            {page === 'doc-compare' && <DocComparePage />}
            {page === 'doc-gen' && <DocGenPage switchPage={switchPage} />}
            {page === 'esign' && <EsignPage />}
            {page === 'legal-search' && <LegalSearchPage />}
            {page === 'office-search' && <OfficeSearchPage />}
            {page === 'reports' && (userRole === 'admin' ? <ReportsPage /> : (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: 340, gap: 12, color: '#64748B', textAlign: 'center', padding: 40 }}>
                <div style={{ fontSize: '3rem' }}>🔒</div>
                <div style={{ fontSize: '1.1rem', fontWeight: 800, color: '#94A3B8' }}>صلاحية محدودة</div>
                <div style={{ fontSize: '.85rem', maxWidth: 320, lineHeight: 1.8 }}>التقارير متاحة لمدير المكتب فقط.</div>
              </div>
            ))}
            {page === 'email' && <EmailPage openModal={setOpenModalId} switchPage={switchPage} />}
            {page === 'notifications' && <NotificationsPage />}
            {page === 'moj' && <MojPage onGuide={openMojGuide} />}
            {page === 'settings' && authUser && <SettingsPage authUser={authUser} onUserUpdate={setAuthUser} isAdmin={userRole === 'admin'} />}
            {page === 'backup' && (userRole === 'admin' ? <BackupPage /> : (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: 340, gap: 12, color: '#64748B', textAlign: 'center', padding: 40 }}>
                <div style={{ fontSize: '3rem' }}>🔒</div>
                <div style={{ fontSize: '1.1rem', fontWeight: 800, color: '#94A3B8' }}>صلاحية محدودة</div>
                <div style={{ fontSize: '.85rem', maxWidth: 320, lineHeight: 1.8 }}>النسخ الاحتياطي متاح لمدير المكتب فقط.</div>
              </div>
            ))}
            {![
              'dash',
              'clients',
              'cases',
              'sessions',
              'invoices',
              'team',
              'timelog',
              'calendar',
              'ai-contract',
              'ai-write',
              'ai-assistant',
              'ai-case',
              'docs',
              'file-search',
              'ocr',
              'doc-compare',
              'doc-gen',
              'esign',
              'legal-search',
              'office-search',
              'reports',
              'email',
              'notifications',
              'moj',
              'settings',
              'backup',
            ].includes(page) && <PlaceholderPage title={titles[page]} />}
          </main>

          {openModalId && (
            <div className="mo open" onMouseDown={(e) => e.target === e.currentTarget && closeModal()}>
              <ModalContent id={openModalId} close={closeModal} mojService={mojService} switchPage={switchPage} ctx={modalCtx} onSuccess={notifyRefresh} onRefresh={bumpRefresh} isAdmin={userRole === 'admin'} />
            </div>
          )}
        </div>
      )}
    </div>
  )
}
