'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { SectionHeader } from '@/components/dashboard/ui'
import { docIcon, fmtSize } from '@/lib/dashboard/format'

type DocItem = { id: string; name: string; type: string; size: number; url: string | null; createdAt: string; case: { number: string; title: string } | null }

export default function DocumentsPage() {
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
