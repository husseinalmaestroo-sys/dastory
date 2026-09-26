'use client'

import { useRef, useState } from 'react'
import { Badge, Risk, SectionHeader } from '@/components/dashboard/ui'

type NamedCitation = { citation?: string }
type Analysis = {
  summary: string
  parties: { role: string; name: string }[]
  facts: string[]
  case_type: string
  cited_articles: string[]
  legal_basis: ({ point: string } & NamedCitation)[]
  possible_defenses: ({ defense: string } & NamedCitation)[]
  strengths: ({ point: string } & NamedCitation)[]
  weaknesses: ({ point: string } & NamedCitation)[]
  gaps: string[]
}
type Source = { ref: number; title: string; lawName: string | null; articleNumber: string | number | null; court: string | null; decisionNumber: string | null; year: number | null; excerpt: string }
type Coverage = { totalChars: number; analyzedChars: number; partial: boolean; notAnalyzed: { fromChar: number; toChar: number; startsWith: string }[] }
type CaseResult = { fileName: string; extractionMethod: string; analysis: Analysis; sources: Source[]; groundingLevel?: 'full' | 'partial' | 'none'; coverage?: Coverage }

const TAB_LABELS = { strategy: 'الاستراتيجية', strength: 'نقاط القوة/الضعف', witnesses: 'الوقائع', docs: 'المصادر' } as const

function sourceLine(s: Source) {
  return [s.lawName || s.title, s.articleNumber ? `المادة ${s.articleNumber}` : null, s.court, s.decisionNumber ? `قرار ${s.decisionNumber}` : null, s.year]
    .filter(Boolean)
    .join(' — ')
}

export default function AiCasePage() {
  const fileRef = useRef<HTMLInputElement | null>(null)
  const [uploading, setUploading] = useState(false)
  const [analyzing, setAnalyzing] = useState(false)
  const [error, setError] = useState('')
  const [notConfigured, setNotConfigured] = useState(false)
  const [result, setResult] = useState<CaseResult | null>(null)
  const [tab, setTab] = useState<keyof typeof TAB_LABELS>('strategy')

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return

    setError(''); setNotConfigured(false); setResult(null)
    setUploading(true)
    try {
      const fd = new FormData()
      fd.append('file', file)
      const uploadRes = await fetch('/api/documents/upload', { method: 'POST', body: fd })
      const uploaded = await uploadRes.json()
      if (!uploadRes.ok) { setError(uploaded.error || 'فشل رفع الملف'); return }
      setUploading(false)

      setAnalyzing(true)
      const analysisRes = await fetch('/api/ai/case-analysis', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ documentId: uploaded.id }),
      })
      const data = await analysisRes.json()
      if (analysisRes.status === 503) { setNotConfigured(true); setError(data.error); return }
      if (!analysisRes.ok) { setError(data.error || 'تعذّر تحليل الملف'); return }
      setResult(data)
      setTab('strategy')
    } catch {
      setError('تعذّر الاتصال بالخادم')
    } finally {
      setUploading(false)
      setAnalyzing(false)
    }
  }

  const busy = uploading || analyzing
  const a = result?.analysis

  return (
    <div className="pg">
      <SectionHeader title="تحليل القضايا بالذكاء الاصطناعي" subtitle="تحليل حقيقي لملف قضية ترفعه، مُسند إلى نصوص قانونية أردنية حقيقية عبر ailegal_hussein" />
      {notConfigured && (
        <div style={{ background: 'rgba(245,158,11,.08)', border: '1px solid rgba(245,158,11,.25)', borderRadius: 10, padding: '10px 14px', marginBottom: 16, fontSize: '.82rem', color: '#F59E0B' }}>
          ⚠️ خدمة تحليل القضايا بالذكاء الاصطناعي غير مُفعّلة على هذا الخادم حالياً.
        </div>
      )}
      <div className="g2">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div className="card">
            <div className="ct">📂 ارفع ملف القضية</div>
            <input ref={fileRef} type="file" accept=".pdf" style={{ display: 'none' }} onChange={handleFile} />
            <button className="upl" onClick={() => fileRef.current?.click()} disabled={busy}>
              <div className="uic">📎</div>
              <div className="ut">{busy ? (uploading ? 'جارٍ رفع الملف...' : 'جارٍ التحليل بالذكاء الاصطناعي...') : (result?.fileName || 'اسحب ملف القضية هنا أو انقر للاختيار (PDF)')}</div>
              <div className="uh">مسودة قضية، لائحة دعوى، أو أي مستند قضائي — PDF حتى 20MB</div>
            </button>
            {error && <div style={{ color: '#F87171', fontSize: '.8rem', marginTop: 10 }}>⚠ {error}</div>}
          </div>
          {a && (
            <div className="card">
              <div className="ct">📊 ملخص القضية {result?.coverage?.partial ? <Badge type="ur">تحليل جزئي</Badge> : <Badge type="ac">مكتمل</Badge>}</div>
              {result?.coverage?.partial && (
                <div role="alert" style={{ background: 'rgba(248,113,113,.08)', border: '1px solid rgba(248,113,113,.3)', borderRadius: 10, padding: '10px 14px', marginBottom: 10, fontSize: '.8rem', color: '#FCA5A5', lineHeight: 1.8 }}>
                  ⚠️ تحليل جزئي: حُلِّل {result.coverage.analyzedChars.toLocaleString('ar')} من {result.coverage.totalChars.toLocaleString('ar')} حرفاً من الملف فقط، ولم تُقرأ بقيته.
                </div>
              )}
              <p style={{ fontSize: '.84rem', color: '#E2E8F0', lineHeight: 1.8, marginBottom: 10 }}>{a.summary}</p>
              <div className="arr"><span className="lb">نوع القضية</span><span className="vl">{a.case_type || 'غير محدد'}</span></div>
              {a.parties.map((p, i) => (
                <div className="arr" key={i}><span className="lb">{p.role}</span><span className="vl">{p.name}</span></div>
              ))}
              {result?.groundingLevel === 'none' && (
                <div style={{ marginTop: 8, fontSize: '.76rem', color: '#F59E0B' }}>⚠️ لم يُعثر على سند قانوني مُتحقَّق منه لأيٍّ من التكييفات أو الدفوع؛ الأطراف والوقائع المعروضة مأخوذة من الملف نفسه.</div>
              )}
            </div>
          )}
        </div>
        {a && (
          <div className="card">
            <div className="tabs">
              {(Object.keys(TAB_LABELS) as (keyof typeof TAB_LABELS)[]).map((k) => (
                <button key={k} className={`tb${tab === k ? ' active' : ''}`} onClick={() => setTab(k)}>{TAB_LABELS[k]}</button>
              ))}
            </div>
            {tab === 'strategy' && (
              <div className="tp active">
                {a.legal_basis.length === 0 && a.possible_defenses.length === 0 && (
                  <div style={{ color: '#64748B', fontSize: '.82rem', padding: 8 }}>لم يُعثر على سند قانوني كافٍ في القاعدة لتكييف هذه القضية أو دفوعها.</div>
                )}
                {a.legal_basis.map((b, i) => <Risk key={`b${i}`} type="ok" title="✅ تكييف قانوني" text={`${b.point}${b.citation ? ` ${b.citation}` : ''}`} />)}
                {a.possible_defenses.map((d, i) => <Risk key={`d${i}`} type="wn" title="⚠️ دفع محتمل" text={`${d.defense}${d.citation ? ` ${d.citation}` : ''}`} />)}
              </div>
            )}
            {tab === 'strength' && (
              <div className="tp active">
                {a.strengths.length === 0 && a.weaknesses.length === 0 && (
                  <div style={{ color: '#64748B', fontSize: '.82rem', padding: 8 }}>لم يُبلَّغ عن نقاط قوة أو ضعف محدَّدة.</div>
                )}
                {a.strengths.map((s, i) => <Risk key={`s${i}`} type="ok" title="نقطة قوة" text={`${s.point}${s.citation ? ` ${s.citation}` : ''}`} />)}
                {a.weaknesses.map((w, i) => <Risk key={`w${i}`} type="dn" title="نقطة ضعف" text={`${w.point}${w.citation ? ` ${w.citation}` : ''}`} />)}
                {a.gaps.length > 0 && (
                  <div style={{ marginTop: 10, fontSize: '.76rem', color: '#F59E0B', background: 'rgba(245,158,11,.06)', borderRadius: 8, padding: '8px 12px' }}>
                    ⚠️ نقاط لم يُعثر لها على سند: {a.gaps.join('، ')}
                  </div>
                )}
              </div>
            )}
            {tab === 'witnesses' && (
              <div className="tp active" style={{ fontSize: '.8rem', color: '#CBD5E1', lineHeight: 1.9 }}>
                {a.facts.length === 0 ? 'لم تُستخرج وقائع محددة.' : a.facts.map((f, i) => <div key={i}>{i + 1}. {f}</div>)}
                {a.cited_articles.length > 0 && (
                  <div style={{ marginTop: 10 }}>
                    <b>مواد وردت في الملف نفسه (كما ذُكرت، غير مُتحقَّق منها في القاعدة):</b>
                    {a.cited_articles.map((c, i) => <div key={i}>• {c}</div>)}
                  </div>
                )}
              </div>
            )}
            {tab === 'docs' && (
              <div className="tp active">
                {result!.sources.length === 0 ? (
                  <div style={{ color: '#64748B', fontSize: '.82rem', padding: 8 }}>لم تُسترجع مصادر قانونية لهذه القضية.</div>
                ) : result!.sources.map((s) => (
                  <div key={s.ref} style={{ padding: 10, marginBottom: 8, borderRadius: 9, background: 'rgba(255,255,255,.03)', border: '1px solid rgba(255,255,255,.06)' }}>
                    <b style={{ fontSize: '.8rem', color: '#E2E8F0' }}>[{s.ref}] {sourceLine(s)}</b>
                    {s.excerpt && <div style={{ fontSize: '.76rem', color: '#94A3B8', background: 'rgba(0,0,0,.15)', borderRadius: 6, padding: '6px 9px', marginTop: 6, fontStyle: 'italic' }}>「{s.excerpt}」</div>}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
        {!a && !busy && (
          <div className="card">
            <div className="ct">💡 كيف تعمل هذه الأداة</div>
            <div style={{ color: '#94A3B8', fontSize: '.82rem', lineHeight: 1.8 }}>
              يُستخرج النص الفعلي من ملف القضية الذي ترفعه، ثم يُبحث في نفس قاعدة التشريعات وقرارات الديوان الخاص بتفسير القانون المستخدمة في البحث القانوني والمساعد العام، لتحديد التكييف القانوني والدفوع المحتملة ونقاط القوة والضعف — كل ذلك مُسنَد لمصادر حقيقية، لا افتراضات.
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
