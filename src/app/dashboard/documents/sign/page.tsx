'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Field, SectionHeader } from '@/components/dashboard/ui'

type SignatureRecord = {
  id: string
  signedAt: string
  signerName: string
  signerEmail: string
  documentHash: string
  matchesCurrentDocument: boolean | null
}

export default function EsignPage() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const drawingRef = useRef(false)
  const lastPointRef = useRef<{ x: number; y: number } | null>(null)
  const [docs, setDocs] = useState<{ id: string; name: string; caseId: string | null; case: { number: string; title: string } | null }[]>([])
  const [selectedDoc, setSelectedDoc] = useState('')
  const [saving, setSaving] = useState(false)
  const [saveErr, setSaveErr] = useState('')
  const [lastSignature, setLastSignature] = useState<{ documentHash: string; signedAt: string; disclosure: string } | null>(null)
  const [history, setHistory] = useState<SignatureRecord[]>([])
  const [loadingHistory, setLoadingHistory] = useState(false)

  const loadDocs = useCallback(() => {
    fetch('/api/documents').then(r => r.json()).then(d => { if (Array.isArray(d)) setDocs(d) }).catch(() => {})
  }, [])
  useEffect(() => { loadDocs() }, [loadDocs])

  const chosen = docs.find(d => d.id === selectedDoc)

  const loadHistory = useCallback((documentId: string) => {
    if (!documentId) { setHistory([]); return }
    setLoadingHistory(true)
    fetch(`/api/documents/${documentId}/sign`)
      .then(r => r.ok ? r.json() : { signatures: [] })
      .then(d => setHistory(Array.isArray(d.signatures) ? d.signatures : []))
      .catch(() => setHistory([]))
      .finally(() => setLoadingHistory(false))
  }, [])
  useEffect(() => { loadHistory(selectedDoc); setLastSignature(null) }, [selectedDoc, loadHistory])

  async function saveSignature() {
    const canvas = canvasRef.current
    if (!canvas || !selectedDoc) return
    setSaving(true); setSaveErr('')
    try {
      const blob: Blob | null = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'))
      if (!blob) { setSaveErr('لا يوجد توقيع مرسوم بعد'); return }
      const fd = new FormData()
      fd.append('signatureImage', new File([blob], 'signature.png', { type: 'image/png' }))
      const res = await fetch(`/api/documents/${selectedDoc}/sign`, { method: 'POST', body: fd })
      const data = await res.json()
      if (!res.ok) { setSaveErr(data.error || 'فشل حفظ التوقيع'); return }
      setLastSignature(data)
      clear()
      loadHistory(selectedDoc)
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
      <SectionHeader title="توقيع المستندات" subtitle="صورة توقيع مرفقة مع سجل تدقيق — وليست توقيعاً إلكترونياً موثقاً قانونياً" />
      <div style={{ background: 'rgba(245,158,11,.07)', border: '1px solid rgba(245,158,11,.2)', borderRadius: 11, padding: '12px 16px', marginBottom: 16, fontSize: '.8rem', color: '#F59E0B', lineHeight: 1.8 }}>
        ⚠️ هذه الأداة ترفق صورة توقيع مرسومة يدوياً مع سجل تدقيق حقيقي (اسم الموقّع، الوقت، وبصمة SHA-256 لمحتوى المستند وقت التوقيع) — وهي <b>ليست</b> توقيعاً إلكترونياً موثقاً قانونياً بموجب قانون المعاملات الإلكترونية الأردني أو أي تشريع آخر. للتوقيع الموثّق قانونياً راجع جهة معتمدة رسمياً.
      </div>
      <div className="g2">
        <div className="card">
          <div className="ct">📄 المستند المطلوب توقيعه</div>
          <Field label="اختر مستنداً من ملفات المكتب" full>
            <select className="fi" value={selectedDoc} onChange={(e) => setSelectedDoc(e.target.value)}>
              <option value="">— اختر مستنداً —</option>
              {docs.map(d => <option key={d.id} value={d.id}>{d.name}{d.case ? ` — قضية ${d.case.number}` : ''}</option>)}
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

          <div style={{ marginTop: 14, borderTop: '1px solid rgba(255,255,255,.06)', paddingTop: 12 }}>
            <div className="ct" style={{ marginBottom: 10 }}>📋 سجل التوقيعات على هذا المستند</div>
            {loadingHistory ? (
              <div style={{ fontSize: '.8rem', color: '#64748B' }}>جارٍ التحميل...</div>
            ) : !selectedDoc ? (
              <div style={{ fontSize: '.8rem', color: '#64748B' }}>اختر مستنداً لعرض سجل توقيعاته</div>
            ) : history.length === 0 ? (
              <div style={{ fontSize: '.8rem', color: '#64748B' }}>لا توجد توقيعات على هذا المستند بعد</div>
            ) : history.map(s => (
              <div key={s.id} style={{ fontSize: '.78rem', color: '#94A3B8', padding: 8, background: 'rgba(255,255,255,.03)', borderRadius: 8, marginBottom: 6 }}>
                <div style={{ color: '#E2E8F0', fontWeight: 700 }}>{s.signerName} <span style={{ fontWeight: 400, color: '#64748B' }}>({s.signerEmail})</span></div>
                <div>{new Date(s.signedAt).toLocaleString('ar-JO')}</div>
                <div style={{ fontFamily: 'monospace', fontSize: '.68rem', wordBreak: 'break-all', color: '#64748B', marginTop: 2 }}>hash: {s.documentHash.slice(0, 24)}…</div>
                {s.matchesCurrentDocument === false && (
                  <div style={{ color: '#F87171', marginTop: 4 }}>⚠ تم تعديل المستند بعد هذا التوقيع — البصمة لا تطابق النسخة الحالية</div>
                )}
                {s.matchesCurrentDocument === true && (
                  <div style={{ color: '#10B981', marginTop: 4 }}>✓ يطابق المستند الحالي</div>
                )}
              </div>
            ))}
          </div>
        </div>

        <div className="card">
          <div className="ct">🖊️ لوحة الرسم</div>
          <canvas ref={canvasRef} id="sig-canvas" onPointerDown={start} onPointerMove={move} onPointerUp={stop} onPointerLeave={stop} />
          <div style={{ marginTop: 10, display: 'flex', gap: 7, flexWrap: 'wrap' }}>
            <button className="dbtn dbtn-p" onClick={saveSignature} disabled={saving || !selectedDoc}>{saving ? 'جارٍ الحفظ...' : '✅ توقيع وحفظ سجل التدقيق'}</button>
            <button className="dbtn dbtn-s" onClick={clear}>🗑️ مسح</button>
          </div>
          {!selectedDoc && <div style={{ fontSize: '.76rem', color: '#64748B', marginTop: 8 }}>اختر مستنداً أولاً</div>}
          {saveErr && <div style={{ color: '#F87171', fontSize: '.8rem', marginTop: 8 }}>⚠ {saveErr}</div>}
          {lastSignature && (
            <div style={{ marginTop: 12, background: 'rgba(16,185,129,.08)', border: '1px solid rgba(16,185,129,.2)', borderRadius: 10, padding: '12px 14px', fontSize: '.78rem', color: '#94A3B8', lineHeight: 1.8 }}>
              <div style={{ color: '#10B981', fontWeight: 700, marginBottom: 6 }}>✅ تم تسجيل التوقيع</div>
              <div>الوقت: {new Date(lastSignature.signedAt).toLocaleString('ar-JO')}</div>
              <div style={{ fontFamily: 'monospace', wordBreak: 'break-all' }}>بصمة المستند (SHA-256): {lastSignature.documentHash}</div>
              <div style={{ marginTop: 8, color: '#F59E0B' }}>{lastSignature.disclosure}</div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
