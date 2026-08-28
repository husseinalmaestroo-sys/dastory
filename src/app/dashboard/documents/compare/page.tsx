'use client'

import { useState } from 'react'
import { SectionHeader } from '@/components/dashboard/ui'

export default function DocComparePage() {
  const [text1, setText1] = useState('')
  const [text2, setText2] = useState('')
  const [diffResult, setDiffResult] = useState<{ type: 'same' | 'add' | 'del'; text: string }[] | null>(null)

  function computeDiff(a: string, b: string) {
    const la = a.split('\n').filter(l => l.trim())
    const lb = b.split('\n').filter(l => l.trim())
    const m = la.length, n = lb.length
    const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0))
    for (let i = 1; i <= m; i++)
      for (let j = 1; j <= n; j++)
        dp[i][j] = la[i-1] === lb[j-1] ? dp[i-1][j-1] + 1 : Math.max(dp[i-1][j], dp[i][j-1])
    const result: { type: 'same' | 'add' | 'del'; text: string }[] = []
    let i = m, j = n
    while (i > 0 || j > 0) {
      if (i > 0 && j > 0 && la[i-1] === lb[j-1]) { result.unshift({ type: 'same', text: la[i-1] }); i--; j-- }
      else if (j > 0 && (i === 0 || dp[i][j-1] >= dp[i-1][j])) { result.unshift({ type: 'add', text: lb[j-1] }); j-- }
      else { result.unshift({ type: 'del', text: la[i-1] }); i-- }
    }
    return result
  }

  const added = diffResult?.filter(d => d.type === 'add').length ?? 0
  const deleted = diffResult?.filter(d => d.type === 'del').length ?? 0
  const same = diffResult?.filter(d => d.type === 'same').length ?? 0

  return (
    <div className="pg">
      <SectionHeader title="مقارنة مستندين" subtitle="الصق نص المستندين وشاهد الفرق سطراً بسطر" />
      <div className="g2" style={{ marginBottom: 14 }}>
        <div className="card">
          <div className="ct">📄 المستند الأول — القديم</div>
          <textarea className="fi" style={{ minHeight: 220, fontSize: '.8rem', lineHeight: 1.8 }} placeholder="الصق نص المستند القديم هنا..." value={text1} onChange={e => setText1(e.target.value)} />
        </div>
        <div className="card">
          <div className="ct">📄 المستند الثاني — الجديد</div>
          <textarea className="fi" style={{ minHeight: 220, fontSize: '.8rem', lineHeight: 1.8 }} placeholder="الصق نص المستند الجديد هنا..." value={text2} onChange={e => setText2(e.target.value)} />
        </div>
      </div>
      <div style={{ marginBottom: 14 }}>
        <button className="dbtn dbtn-p" disabled={!text1.trim() || !text2.trim()} onClick={() => setDiffResult(computeDiff(text1, text2))}>🔀 مقارنة المستندين</button>
        {diffResult && <button className="dbtn dbtn-s" style={{ marginRight: 8 }} onClick={() => { setDiffResult(null); setText1(''); setText2('') }}>مسح</button>}
      </div>
      {diffResult && (
        <div className="card">
          <div className="ct">📊 نتائج المقارنة</div>
          <div style={{ display: 'flex', gap: 20, marginBottom: 12, fontSize: '.78rem' }}>
            <span style={{ color: '#6EE7B7' }}>● {added} سطر مضاف</span>
            <span style={{ color: '#FCA5A5' }}>● {deleted} سطر محذوف</span>
            <span style={{ color: '#94A3B8' }}>● {same} سطر مشترك</span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            {diffResult.map((d, i) => d.text ? (
              <div key={i} className={`df ${d.type === 'add' ? 'add' : d.type === 'del' ? 'del' : 'same'}`}>
                {d.type === 'add' ? '+ ' : d.type === 'del' ? '- ' : '  '}{d.text}
              </div>
            ) : null)}
          </div>
        </div>
      )}
    </div>
  )
}
