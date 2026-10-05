'use client'

import { useState } from 'react'
import { Badge, SectionHeader } from '@/components/dashboard/ui'
import { AUTHORITY_LABEL_AR, MODE_LABEL_AR, SOURCE_CLASS_LABEL_AR, citedSourcesLabel } from '@/lib/ai/source-labels'
import type { AuthorityLevel, SourceClass } from '@/lib/ai/engine-schema'

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
  cited?: boolean
  /** What may be said about the text (engine corpus/integrity.ts) — the card says no more. */
  authorityLevel?: AuthorityLevel
  sourceClass?: SourceClass | null
}
type SearchResult = {
  answer: string
  grounded: boolean
  mode: string
  sources: Citation[]
  disclaimer?: string
  confidence: string | null
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

  const modeInfo = result ? (MODE_LABEL_AR[result.mode] ?? { type: 'bl' as const, label: 'حالة إجابة غير معروفة' }) : null

  return (
    <div className="pg">
      <SectionHeader title="البحث القانوني" subtitle="بحث في نصوص التشريعات الأردنية المحفوظة في قاعدة البيانات وقرارات الديوان الخاص بتفسير القوانين — لا يجيب من معرفة عامة إلا بتنويه صريح" />
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
                المصادر ({result.sources.length}) — {citedSourcesLabel(result.sources)}
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
                    <div style={{ fontSize: '.72rem', color: '#94A3B8', marginBottom: 4 }}>
                      {[s.sourceClass ? SOURCE_CLASS_LABEL_AR[s.sourceClass] : null, AUTHORITY_LABEL_AR[s.authorityLevel ?? 'unrecorded_not_verified']]
                        .filter(Boolean)
                        .join(' · ')}
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
            💡 يبحث هذا القسم في نصوص التشريعات الأردنية المحفوظة في قاعدة البيانات التي اجتازت فحص سلامة النص، وفي قرارات الديوان الخاص بتفسير القوانين. النص الذي لم يجتز الفحص محجوب: لا يُقتبس منه، ويُقال ذلك صراحة. تُبيَّن مع كل مصدر جهة نشره وما إذا قورن بالجريدة الرسمية. إن لم يجد سنداً واضحاً لسؤالك يصرّح بذلك، أو يقدّم توجيهاً عاماً موسوماً بوضوح أنه غير مُسند لمصدر — ولا يخترع رقم مادة أو قرار مطلقاً.
          </div>
        </div>
      )}
    </div>
  )
}
