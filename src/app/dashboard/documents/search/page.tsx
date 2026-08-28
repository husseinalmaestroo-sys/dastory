'use client'

import { useState } from 'react'
import { FileHit, SectionHeader } from '@/components/dashboard/ui'
import { docIcon } from '@/lib/dashboard/format'

export default function FileSearchPage() {
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
