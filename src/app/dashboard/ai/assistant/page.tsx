'use client'

import { useState } from 'react'
import { SectionHeader } from '@/components/dashboard/ui'
import type { ChatMessage } from '@/lib/dashboard/types'

const WELCOME: ChatMessage = {
  role: 'a',
  text: 'مرحباً! أنا مساعد قانوني عام يعمل بالذكاء الاصطناعي (Claude). يمكنني مساعدتك بمعلومات تمهيدية عامة، لكن لا تتوفر لديّ قاعدة بيانات تشريعية أو قضائية أردنية موثّقة للبحث فيها — أي إشارة لمادة قانونية أو حكم قضائي محدد تحتاج تحققاً مستقلاً قبل الاعتماد عليها.',
}

export default function AiAssistantPage() {
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notConfigured, setNotConfigured] = useState(false)
  const [messages, setMessages] = useState<ChatMessage[]>([WELCOME])

  const send = async (value = input) => {
    const question = value.trim()
    if (!question || busy) return
    setError('')
    setMessages((items) => [...items, { role: 'u', text: question }])
    setInput('')
    setBusy(true)
    try {
      const res = await fetch('/api/ai/assistant', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: question,
          history: messages.slice(-12).map((m) => ({ role: m.role, text: m.text })),
        }),
      })
      const data = await res.json()
      if (res.status === 503) { setNotConfigured(true); setError(data.error); return }
      if (!res.ok) { setError(data.error || 'تعذّر الحصول على رد'); return }
      setMessages((items) => [...items, { role: 'a', text: data.text, citation: data.disclaimer }])
    } catch {
      setError('تعذّر الاتصال بالخادم')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="pg" style={{ padding: 0 }}>
      <div style={{ padding: '16px 18px 0' }}>
        <SectionHeader title="المساعد القانوني الذكي" subtitle="يعمل بذكاء اصطناعي حقيقي (Claude) — وليس إجابات جاهزة مسبقاً" />
        {notConfigured && (
          <div style={{ background: 'rgba(245,158,11,.08)', border: '1px solid rgba(245,158,11,.25)', borderRadius: 10, padding: '10px 14px', marginBottom: 12, fontSize: '.82rem', color: '#F59E0B' }}>
            ⚠️ خدمة الذكاء الاصطناعي غير مُفعّلة على هذا الخادم حالياً (يلزم إعداد ANTHROPIC_API_KEY في متغيرات البيئة).
          </div>
        )}
        <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap', marginBottom: 12 }}>
          {['ما الفرق بين الفسخ والإنهاء في عقود العمل؟', 'ما هي الخطوات العامة لرفع دعوى مدنية؟', 'ما مدة التقادم في الدعاوى المدنية بشكل عام؟'].map((q) => (
            <button key={q} className="dbtn dbtn-s" style={{ fontSize: '.74rem' }} onClick={() => send(q)} disabled={busy || notConfigured}>{q.length > 32 ? q.slice(0, 32) : q}</button>
          ))}
        </div>
      </div>
      <div className="cw">
        <div className="cm">
          {messages.map((message, index) => (
            <div key={index} className={`msg ${message.role}`}>
              <span style={{ whiteSpace: 'pre-wrap' }}>{message.text}</span>
              {message.citation && <div className="cit">⚠️ {message.citation}</div>}
            </div>
          ))}
          {busy && <div className="msg a"><div className="tdots"><span /><span /><span /></div></div>}
          {error && !notConfigured && <div style={{ color: '#F87171', fontSize: '.8rem', padding: '8px 0' }}>⚠ {error}</div>}
        </div>
        <div className="ci-row">
          <input className="ci" value={input} onChange={(e) => setInput(e.target.value)} placeholder="اكتب سؤالك القانوني هنا..." onKeyDown={(e) => e.key === 'Enter' && send()} disabled={notConfigured} />
          <button className="dbtn dbtn-p" onClick={() => send()} disabled={busy || notConfigured}>إرسال ↵</button>
        </div>
      </div>
    </div>
  )
}
