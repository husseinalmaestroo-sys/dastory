'use client'

import { useState } from 'react'
import { statusAr } from '@/lib/api'
import { Badge, InfoLine, SectionHeader } from '@/components/dashboard/ui'

type OfficeSearchResults = {
  clients: { id: string; name: string; phone: string | null; email: string | null }[]
  cases: { id: string; number: string; title: string; status: string; client: { name: string } }[]
  invoices: { id: string; number: string; amount: number; status: string; client: { name: string } }[]
  documents: { id: string; name: string; type: string; case: { number: string } | null }[]
}

export default function OfficeSearchPage() {
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
