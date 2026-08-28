'use client'

import { useState } from 'react'
import { Badge, SectionHeader } from '@/components/dashboard/ui'

type Citation = {
  ref: number
  title: string
  sourceType: string
  articleNumber: string | number | null
  lawName: string | null
  court: string | null
  decisionNumber: string | null
  year: number | null
  excerpt: string
}
type SearchResult = {
  answer: string
  grounded: boolean
  mode: string
  sources: Citation[]
  disclaimer?: string
  confidence: string | null
}

const MODE_BADGE: Record<string, { type: 'go' | 'pe' | 'ur'; label: string }> = {
  grounded: { type: 'go', label: 'مُسند لمصدر موثّق' },
  grounded_retry: { type: 'go', label: 'مُسند لمصدر موثّق' },
  general: { type: 'pe', label: 'إجابة عامة — بلا استشهاد' },
  refused: { type: 'ur', label: 'لم يُعثر على سند' },
}

const SUGGESTED = [
  'هل يجوز فصل الموظف أثناء الإجازة المرضية؟',
  'ما شروط تسجيل شركة ذات مسؤولية محدودة في الأردن؟',
  'ما حقوق المستأجر عند طلب الإخلاء؟',
  'ما هي إجراءات الاستئناف المدني؟',
]

export default function LegalSearchPage() {
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [notConfigured, setNotConfigured] = useState(false)
  const [result, setResult] = useState<SearchResult | null>(null)

  const search = async (value = query) => {
    const question = value.trim()
    if (!question || loading) return
    setQuery(question)
    setError(''); setNotConfigured(false); setResult(null)
    setLoading(true)
    try {
      const res = await fetch('/api/search/legal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question }),
      })
      const data = await res.json()
      if (res.status === 503) { setNotConfigured(true); setError(data.error); return }
      if (!res.ok) { setError(data.error || 'تعذّر تنفيذ البحث'); return }
      setResult(data)
    } catch {
      setError('تعذّر الاتصال بالخادم')
    } finally {
      setLoading(false)
    }
  }

  const modeInfo = result ? (MODE_BADGE[result.mode] ?? { type: 'bl' as const, label: result.mode }) : null

  return (
    <div className="pg">
      <SectionHeader title="البحث القانوني" subtitle="بحث حقيقي في نصوص التشريعات الأردنية وقرارات الديوان الخاص بتفسير القانون — لا يجيب من معرفة عامة إلا بتنويه صريح" />
      {notConfigured && (
        <div style={{ background: 'rgba(245,158,11,.08)', border: '1px solid rgba(245,158,11,.25)', borderRadius: 10, padding: '10px 14px', marginBottom: 14, fontSize: '.82rem', color: '#F59E0B' }}>
          ⚠️ خدمة البحث القانوني غير مُفعّلة على هذا الخادم حالياً.
        </div>
      )}
      <div className="sb2">
        <div className="si">⚖️</div>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="هل يجوز فصل الموظف أثناء الإجازة المرضية؟"
          onKeyDown={(e) => e.key === 'Enter' && search()}
          disabled={loading}
        />
        <button className="dbtn dbtn-p" onClick={() => search()} disabled={loading || !query.trim()}>
          {loading ? 'جارٍ البحث...' : 'بحث'}
        </button>
      </div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
        {SUGGESTED.map((q) => (
          <button key={q} className="dbtn dbtn-s" style={{ fontSize: '.74rem' }} onClick={() => search(q)} disabled={loading}>
            {q}
          </button>
        ))}
      </div>

      {error && !notConfigured && (
        <div className="card" style={{ marginBottom: 14 }}>
          <div style={{ color: '#F87171', fontSize: '.84rem' }}>⚠ {error}</div>
        </div>
      )}

      {result && (
        <div className="card">
          <div className="ct" style={{ justifyContent: 'space-between', display: 'flex' }}>
            <span>⚖️ الإجابة</span>
            {modeInfo && <Badge type={modeInfo.type}>{modeInfo.label}</Badge>}
          </div>
          <p style={{ fontSize: '.88rem', color: '#E2E8F0', lineHeight: 1.9, whiteSpace: 'pre-wrap', marginBottom: 10 }}>
            {result.answer || 'لم يصل نص إجابة.'}
          </p>
          {result.disclaimer && (
            <div style={{ fontSize: '.76rem', color: '#F59E0B', background: 'rgba(245,158,11,.06)', borderRadius: 8, padding: '8px 12px', marginBottom: 12 }}>
              ⚠️ {result.disclaimer}
            </div>
          )}

          {result.sources.length > 0 && (
            <>
              <div style={{ fontSize: '.78rem', color: '#64748B', marginBottom: 8, fontWeight: 600 }}>
                المصادر ({result.sources.length})
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {result.sources.map((s) => (
                  <div key={s.ref} style={{ padding: 10, borderRadius: 9, background: 'rgba(255,255,255,.03)', border: '1px solid rgba(255,255,255,.06)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginBottom: 4 }}>
                      <b style={{ fontSize: '.8rem', color: '#E2E8F0' }}>
                        [{s.ref}] {s.lawName || s.title}
                        {s.articleNumber ? ` — المادة ${s.articleNumber}` : ''}
                      </b>
                    </div>
                    {(s.court || s.decisionNumber || s.year) && (
                      <div style={{ fontSize: '.74rem', color: '#64748B', marginBottom: 4 }}>
                        {[s.court, s.decisionNumber ? `قرار رقم ${s.decisionNumber}` : null, s.year]
                          .filter(Boolean)
                          .join(' · ')}
                      </div>
                    )}
                    {s.excerpt && (
                      <div style={{ fontSize: '.76rem', color: '#94A3B8', background: 'rgba(0,0,0,.15)', borderRadius: 6, padding: '6px 9px', fontStyle: 'italic' }}>
                        「{s.excerpt}」
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      )}

      {!result && !loading && !error && (
        <div className="card">
          <div style={{ color: '#94A3B8', fontSize: '.82rem', lineHeight: 1.8, padding: 8 }}>
            💡 يبحث هذا القسم فعلياً في نصوص قوانين وأنظمة أردنية حقيقية (المدني، العمل، الشركات، الأحوال الشخصية، الملكية العقارية، التجارة، حماية المستهلك وغيرها) وقرارات الديوان الخاص بتفسير القانون. إن لم يجد سنداً واضحاً لسؤالك يصرّح بذلك، أو يقدّم توجيهاً عاماً موسوماً بوضوح أنه غير مُسند لمصدر — ولا يخترع رقم مادة أو قرار مطلقاً.
          </div>
        </div>
      )}
    </div>
  )
}
