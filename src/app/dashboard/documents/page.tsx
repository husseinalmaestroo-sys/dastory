'use client'

import { useEffect, useRef, useState } from 'react'
import { ErrorState, LoadMore, SectionHeader } from '@/components/dashboard/ui'
import { docIcon, fmtSize } from '@/lib/dashboard/format'
import { usePaginatedList } from '@/components/dashboard/usePaginatedList'
import { apiFetch, errorMessage, fetchAllPages } from '@/lib/dashboard/api-client'

type DocItem = { id: string; name: string; type: string; size: number; url: string | null; createdAt: string; case: { number: string; title: string } | null }

const TYPE_FILTERS: Record<string, string> = {
  'الكل': '',
  'PDF': 'PDF',
  'Word': 'DOC,DOCX',
  'Excel': 'XLS,XLSX',
  'صور': 'PNG,JPG,JPEG',
}

export default function DocumentsPage() {
  const [search, setSearch] = useState('')
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState('الكل')
  const [reloadKey, setReloadKey] = useState(0)
  const uploadRef = useRef<HTMLInputElement | null>(null)
  const [cases, setCases] = useState<{ id: string; number: string; title: string }[]>([])
  const [casesError, setCasesError] = useState('')
  const [pendingFile, setPendingFile] = useState<File | null>(null)
  const [selectedCase, setSelectedCase] = useState('')
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState('')

  useEffect(() => {
    const q = search.trim()
    const timer = window.setTimeout(() => setQuery(q), q ? 300 : 0)
    return () => window.clearTimeout(timer)
  }, [search])

  const params = new URLSearchParams()
  if (query) params.set('q', query)
  if (TYPE_FILTERS[filter]) params.set('types', TYPE_FILTERS[filter])
  const qs = params.toString()
  const list = usePaginatedList<DocItem>(`/api/documents${qs ? `?${qs}` : ''}`, reloadKey)

  // The case picker must offer every case, not only the first page.
  useEffect(() => {
    let cancelled = false
    fetchAllPages<any>('/api/cases')
      .then(({ items }) => { if (!cancelled) setCases(items.map((c) => ({ id: c.id, number: c.number, title: c.title }))) })
      .catch((err) => { if (!cancelled) setCasesError(errorMessage(err)) })
    return () => { cancelled = true }
  }, [])

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
      await apiFetch('/api/documents/upload', { method: 'POST', body: fd })
      setPendingFile(null); setSelectedCase('')
      setReloadKey((k) => k + 1)
    } catch (err) { setUploadError(errorMessage(err)) }
    finally { setUploading(false) }
  }

  return (
    <div className="pg">
      <SectionHeader title="إدارة الملفات" subtitle={list.loading ? 'جاري التحميل...' : `${list.total ?? list.items.length} ملف`}>
        <input ref={uploadRef} type="file" accept=".pdf,.doc,.docx,.xls,.xlsx,.jpg,.jpeg,.png,.txt" style={{ display: 'none' }} onChange={handleFile} />
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
            {casesError && <div style={{ color: '#F87171', fontSize: '.75rem', marginTop: 4 }}>⚠️ تعذّر تحميل قائمة القضايا: {casesError}</div>}
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
        {Object.keys(TYPE_FILTERS).map(label => (
          <button key={label} className={`dbtn ${filter === label ? 'dbtn-p' : 'dbtn-s'}`} style={{ fontSize: '.74rem' }} onClick={() => setFilter(label)}>{label}</button>
        ))}
      </div>
      <div className="card">
        <div className="ct">📁 المستندات</div>
        {list.loading ? (
          <div style={{ color: '#64748B', textAlign: 'center', padding: 24 }}>جاري التحميل...</div>
        ) : list.error && list.items.length === 0 ? (
          <ErrorState message={list.error} onRetry={list.retry} />
        ) : list.items.length === 0 ? (
          <div style={{ color: '#64748B', textAlign: 'center', padding: 24 }}>لا توجد ملفات</div>
        ) : (
          <>
            <div className="fg2">
              {list.items.map(d => (
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
            {list.error && <ErrorState message={list.error} onRetry={list.loadMore} />}
            <LoadMore shown={list.items.length} total={list.total} hasMore={list.hasMore} loading={list.loadingMore} onClick={list.loadMore} />
          </>
        )}
      </div>
    </div>
  )
}
