'use client'

import { useRef, useState } from 'react'
import { Badge, SectionHeader } from '@/components/dashboard/ui'

type Risk = { severity: 'high' | 'medium' | 'low' | 'info'; title: string; excerpt: string; explanation: string }
type Citation = {
  ref: number
  title: string
  articleNumber: string | number | null
  lawName: string | null
  court: string | null
  decisionNumber: string | null
  year: number | null
  excerpt: string
}
type ReviewResult = {
  summary: string
  parties: string[]
  keyTerms: { label: string; value: string }[]
  risks: Risk[]
  sources: Citation[]
  extractionMethod: string
  truncated: boolean
  disclaimer: string
  coverage?: {
    totalChars: number
    analyzedChars: number
    partial: boolean
    notAnalyzed: { fromChar: number; toChar: number; startsWith: string }[]
  }
}

const SEVERITY_BADGE: Record<Risk['severity'], 'ur' | 'pe' | 'bl' | 'ac'> = { high: 'ur', medium: 'pe', low: 'bl', info: 'ac' }
const SEVERITY_LABEL: Record<Risk['severity'], string> = { high: 'خطر مرتفع', medium: 'يحتاج مراجعة', low: 'ملاحظة بسيطة', info: 'معلومة' }
const METHOD_LABEL: Record<string, string> = {
  'pdf-text-layer': 'نص مستخرج مباشرة من طبقة النص في الملف',
  'pdf-ocr': 'نص مستخرج عبر التعرف الضوئي على الحروف (OCR) — الملف كان ممسوحاً ضوئياً بلا طبقة نص',
  docx: 'نص مستخرج من ملف Word',
  ocr: 'نص مستخرج عبر التعرف الضوئي على الحروف (OCR)',
  'plain-text': 'نص عادي',
}

export default function AiContractPage() {
  const fileRef = useRef<HTMLInputElement | null>(null)
  const [uploading, setUploading] = useState(false)
  const [analyzing, setAnalyzing] = useState(false)
  const [error, setError] = useState('')
  const [notConfigured, setNotConfigured] = useState(false)
  const [fileName, setFileName] = useState('')
  const [result, setResult] = useState<ReviewResult | null>(null)

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return

    setError(''); setNotConfigured(false); setResult(null); setFileName(file.name)
    setUploading(true)
    try {
      const fd = new FormData()
      fd.append('file', file)
      const uploadRes = await fetch('/api/documents/upload', { method: 'POST', body: fd })
      const uploaded = await uploadRes.json()
      if (!uploadRes.ok) { setError(uploaded.error || 'فشل رفع الملف'); return }
      setUploading(false)

      setAnalyzing(true)
      const reviewRes = await fetch('/api/ai/contract-review', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ documentId: uploaded.id }),
      })
      const reviewData = await reviewRes.json()
      if (reviewRes.status === 503) { setNotConfigured(true); setError(reviewData.error); return }
      if (!reviewRes.ok) { setError(reviewData.error || 'تعذّر تحليل العقد'); return }
      setResult(reviewData)
    } catch {
      setError('تعذّر الاتصال بالخادم')
    } finally {
      setUploading(false)
      setAnalyzing(false)
    }
  }

  const busy = uploading || analyzing

  return (
    <div className="pg">
      <SectionHeader title="مراجعة العقود بالذكاء الاصطناعي" subtitle="تحليل حقيقي لمحتوى الملف الذي ترفعه — لا نتائج جاهزة مسبقاً" />
      {notConfigured && (
        <div style={{ background: 'rgba(245,158,11,.08)', border: '1px solid rgba(245,158,11,.25)', borderRadius: 10, padding: '10px 14px', marginBottom: 14, fontSize: '.82rem', color: '#F59E0B' }}>
          ⚠️ خدمة تحليل العقود بالذكاء الاصطناعي غير مُفعّلة على هذا الخادم حالياً.
        </div>
      )}
      <div className="g2">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div className="card">
            <div className="ct">📤 رفع العقد</div>
            <input ref={fileRef} type="file" accept=".pdf,.docx,.png,.jpg,.jpeg,.txt" style={{ display: 'none' }} onChange={handleFile} />
            <button className="upl" onClick={() => fileRef.current?.click()} disabled={busy}>
              <div className="uic">📄</div>
              <div className="ut">{busy ? (uploading ? 'جارٍ رفع الملف...' : 'جارٍ التحليل بالذكاء الاصطناعي...') : (fileName || 'اسحب العقد هنا أو انقر للاختيار')}</div>
              <div className="uh">PDF · Word (docx) · صور · حتى 20MB</div>
            </button>
            {error && <div style={{ color: '#F87171', fontSize: '.8rem', marginTop: 10 }}>⚠ {error}</div>}
          </div>
          {result && (
            <div className="card">
              <div className="ct">📋 ملخص التحليل {result.coverage?.partial || result.truncated ? <Badge type="ur">مراجعة جزئية — PARTIAL REVIEW</Badge> : <Badge type="ac">مكتمل</Badge>}</div>
              <div style={{ fontSize: '.78rem', color: '#64748B', marginBottom: 10 }}>{METHOD_LABEL[result.extractionMethod] ?? result.extractionMethod}</div>
              {(result.coverage?.partial || result.truncated) && (
                <div role="alert" style={{ background: 'rgba(248,113,113,.08)', border: '1px solid rgba(248,113,113,.3)', borderRadius: 10, padding: '10px 14px', marginBottom: 12, fontSize: '.8rem', color: '#FCA5A5', lineHeight: 1.8 }}>
                  ⚠️ مراجعة جزئية: لم يُحلَّل كامل العقد
                  {result.coverage ? ` (حُلِّل ${result.coverage.analyzedChars.toLocaleString('ar')} من ${result.coverage.totalChars.toLocaleString('ar')} حرفاً)` : ''}.
                  لا تعتمد هذه المراجعة لبنود الأجزاء غير المحلَّلة:
                  {result.coverage?.notAnalyzed.map((r, i) => (
                    <div key={i} style={{ fontSize: '.76rem' }}>• الأحرف {r.fromChar.toLocaleString('ar')}–{r.toChar.toLocaleString('ar')}{r.startsWith ? ` (تبدأ بـ: «${r.startsWith.slice(0, 60)}»)` : ''}</div>
                  ))}
                </div>
              )}
              <p style={{ fontSize: '.84rem', color: '#E2E8F0', lineHeight: 1.8, marginBottom: 12 }}>{result.summary}</p>
              {result.parties.length > 0 && (
                <div className="ar">
                  {result.parties.map((p, i) => (
                    <div className="arr" key={i}><span className="lb">طرف {i + 1}</span><span className="vl">{p}</span></div>
                  ))}
                </div>
              )}
              {result.keyTerms.length > 0 && (
                <div className="ar" style={{ marginTop: 10 }}>
                  {result.keyTerms.map((t, i) => (
                    <div className="arr" key={i}><span className="lb">{t.label}</span><span className="vl">{t.value}</span></div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {result && (
            <div className="card">
              <div className="ct">⚠️ الملاحظات والمخاطر ({result.risks.length})</div>
              {result.risks.length === 0 ? (
                <div style={{ color: '#64748B', fontSize: '.82rem', padding: 8 }}>لم يُبلَّغ عن ملاحظات محددة في هذا التحليل.</div>
              ) : result.risks.map((r, i) => (
                <div key={i} style={{ padding: 10, marginBottom: 8, borderRadius: 9, background: 'rgba(255,255,255,.03)', border: '1px solid rgba(255,255,255,.06)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                    <b style={{ fontSize: '.82rem', color: '#E2E8F0' }}>{r.title}</b>
                    <Badge type={SEVERITY_BADGE[r.severity]}>{SEVERITY_LABEL[r.severity]}</Badge>
                  </div>
                  {r.excerpt && (
                    <div style={{ fontSize: '.76rem', color: '#94A3B8', background: 'rgba(0,0,0,.15)', borderRadius: 6, padding: '6px 9px', marginBottom: 6, fontStyle: 'italic' }}>
                      「{r.excerpt}」
                    </div>
                  )}
                  <div style={{ fontSize: '.78rem', color: '#CBD5E1' }}>{r.explanation}</div>
                </div>
              ))}
              <div style={{ marginTop: 10, fontSize: '.74rem', color: '#F59E0B', background: 'rgba(245,158,11,.06)', borderRadius: 8, padding: '8px 12px' }}>
                ⚠️ {result.disclaimer}
              </div>
            </div>
          )}
          {result && result.sources.length > 0 && (
            <div className="card">
              <div className="ct">📚 المصادر القانونية ({result.sources.length})</div>
              <div style={{ fontSize: '.76rem', color: '#64748B', marginBottom: 8 }}>
                نصوص أردنية استُرجعت من قاعدة ailegal_hussein وأُشير إليها بـ[رقم] في الملاحظات أعلاه.
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {result.sources.map((s) => (
                  <div key={s.ref} style={{ padding: 10, borderRadius: 9, background: 'rgba(255,255,255,.03)', border: '1px solid rgba(255,255,255,.06)' }}>
                    <b style={{ fontSize: '.8rem', color: '#E2E8F0' }}>
                      [{s.ref}] {s.lawName || s.title}
                      {s.articleNumber ? ` — المادة ${s.articleNumber}` : ''}
                    </b>
                    {(s.court || s.decisionNumber || s.year) && (
                      <div style={{ fontSize: '.74rem', color: '#64748B', marginTop: 4 }}>
                        {[s.court, s.decisionNumber ? `قرار رقم ${s.decisionNumber}` : null, s.year].filter(Boolean).join(' · ')}
                      </div>
                    )}
                    {s.excerpt && (
                      <div style={{ fontSize: '.76rem', color: '#94A3B8', background: 'rgba(0,0,0,.15)', borderRadius: 6, padding: '6px 9px', marginTop: 6, fontStyle: 'italic' }}>
                        「{s.excerpt}」
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
          {!result && !busy && (
            <div className="card">
              <div className="ct">💡 كيف تعمل هذه الأداة</div>
              <div style={{ color: '#94A3B8', fontSize: '.82rem', lineHeight: 1.8 }}>
                يُستخرج النص الفعلي من الملف الذي ترفعه (طبقة نص PDF، أو Word، أو تعرّف ضوئي حقيقي على الحروف للصور والملفات الممسوحة ضوئياً)، ثم يُرسَل هذا النص فقط إلى خدمة ailegal_hussein التي تحلّله وتستند في ملاحظاتها القانونية إلى نصوص تشريعية أردنية حقيقية تُذكر في المصادر. لا توجد نتائج جاهزة مسبقاً — التحليل يعتمد كلياً على محتوى ملفك.
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
