import { isValidElement, cloneElement, useId, type ReactElement } from 'react'
import type React from 'react'

export function Badge({ type = 'ac', children }: { type?: 'ac' | 'pe' | 'cl' | 'ur' | 'go' | 'bl' | 'pu'; children: React.ReactNode }) {
  return <span className={`bx ${type}`}>{children}</span>
}

// Every dashboard form field goes through here, so this is the single place
// that determines whether the whole app's forms are screen-reader-labeled.
// Previously the <label> had no htmlFor and the input no id — visually
// adjacent, but programmatically disconnected: a screen reader announced
// the input with no name, and clicking the label text didn't focus it.
// cloneElement wires them together without changing markup shape or
// requiring every call site to invent and pass its own id.
export function Field({ label, children, full = false }: { label: string; children: React.ReactNode; full?: boolean }) {
  const generatedId = useId()
  const child = isValidElement(children) ? (children as ReactElement<{ id?: string }>) : null
  const inputId = child?.props.id ?? generatedId

  return (
    <div className={`ff${full ? ' full' : ''}`}>
      <label htmlFor={inputId}>{label}</label>
      {child ? cloneElement(child, { id: inputId }) : children}
    </div>
  )
}

export function SectionHeader({
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

export function StatCard({ icon, value, label, change, down = false }: { icon: string; value: string; label: string; change?: string; down?: boolean }) {
  return (
    <div className="sc">
      <div className="sic">{icon}</div>
      <div className="sv">{value}</div>
      <div className="sl">{label}</div>
      {change && <div className={`sch ${down ? 'dn' : 'up'}`}>{change}</div>}
    </div>
  )
}

export function QuickAction({ icon, label, onClick }: { icon: string; label: string; onClick: () => void }) {
  return (
    <button className="qb" onClick={onClick}>
      <div className="qbi">{icon}</div>
      <div className="qbl">{label}</div>
    </button>
  )
}

export function Notification({ icon, color, title, subtitle, time }: { icon: string; color: string; title: string; subtitle: string; time: string }) {
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

export function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return <button className={`tb${active ? ' active' : ''}`} onClick={onClick}>{children}</button>
}

export function DetailRow({ label, value }: { label: string; value: string }) {
  return <div className="arr"><span className="lb">{label}</span><span className="vl">{value}</span></div>
}

export function InfoLine({ text, badge }: { text: string; badge?: React.ReactNode }) {
  return (
    <div style={{ fontSize: '.8rem', color: '#CBD5E1', padding: 8, background: 'rgba(255,255,255,.03)', borderRadius: 8, marginBottom: 6, display: 'flex', justifyContent: 'space-between', gap: 8 }}>
      <span>{text}</span>
      {badge}
    </div>
  )
}

export function TimelineItem({ date, text, color }: { date: string; text: string; color: string }) {
  return (
    <div className="tli">
      <div className="tld" style={{ background: color }} />
      <div className="tdate">{date}</div>
      <div className="ttxt">{text}</div>
    </div>
  )
}

export function Risk({ type, title, text }: { type: 'dn' | 'wn' | 'ok'; title: string; text: string }) {
  return (
    <div className={`ri ${type}`}>
      <div>
        <div className="rt">{title}</div>
        <div className="rs">{text}</div>
      </div>
    </div>
  )
}

export function FileHit({ icon, name, status, color }: { icon: string; name: string; status: string; color: string }) {
  return (
    <div className="fc">
      <div className="fic">{icon}</div>
      <div className="fnm">{name}</div>
      <div className="fsz" style={{ color }}>{status}</div>
    </div>
  )
}

export function LegalResult({ title, mat, text, why }: { title: string; mat: string; text: string; why: string }) {
  return (
    <div className="lrc">
      <div className="lrc-title">{title}</div>
      <div className="lrc-mat">{mat}</div>
      <div className="lrc-text">{text}</div>
      <div className="lrc-why">{why}</div>
    </div>
  )
}

export function SettingRow({ title, sub, right, accent = 'rgba(255,255,255,.03)', border = 'transparent' }: { title: string; sub: string; right: React.ReactNode; accent?: string; border?: string }) {
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

export function Bars({ items }: { items: string[][] }) {
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

export function CalendarItem({ color, title, subtitle }: { color: string; title: string; subtitle: string }) {
  return (
    <div style={{ padding: 10, borderRight: `3px solid ${color}`, background: 'rgba(255,255,255,.03)', borderRadius: 7, marginBottom: 8 }}>
      <div style={{ fontSize: '.82rem', fontWeight: 700, color: '#E2E8F0' }}>{title}</div>
      <div style={{ fontSize: '.74rem', color: '#64748B' }}>{subtitle}</div>
    </div>
  )
}
