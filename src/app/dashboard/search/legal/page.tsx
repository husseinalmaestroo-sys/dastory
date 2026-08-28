'use client'

import { useState } from 'react'
import { LegalResult, SectionHeader } from '@/components/dashboard/ui'

// This page is a labeled PREVIEW, not a real legal search: there is no
// ingested, verified corpus of Jordanian legislation or case law behind it,
// and no retrieval system (no RAG) — see ARCHITECTURE.md "Known gaps." The
// tiny keyword map below is illustrative only. It previously also rendered
// a fabricated Court of Cassation ruling as if it were a real citation —
// removed: inventing a specific judicial decision and attributing it to a
// real court is exactly the kind of legal misinformation this feature must
// never produce, demo or not.
const ILLUSTRATIVE_DB: Record<string, string> = {
  'إجازة مرضية': 'المادة 65 من قانون العمل الأردني تنص على أن العامل يستحق إجازة مرضية ضمن حدود القانون، ولا يجوز استعمال المرض كسبب تعسفي للفصل.',
  استئناف: 'مدة الاستئناف في القضايا المدنية تكون غالباً 30 يوماً من تاريخ تبليغ الحكم، مع مراعاة الأحكام الخاصة.',
  'شركة ذات': 'يتطلب تسجيل شركة ذات مسؤولية محدودة عقد تأسيس موثقاً وبيانات الشركاء ورأس المال والتسجيل لدى دائرة مراقبة الشركات.',
  مستأجر: 'لا يُخلى المستأجر إلا وفق أسباب وإجراءات يحددها القانون وبقرار قضائي عند النزاع.',
}

export default function LegalSearchPage() {
  const [query, setQuery] = useState('')
  const [result, setResult] = useState<string | null>(null)
  const [searched, setSearched] = useState(false)

  const search = (value = query) => {
    setQuery(value)
    setSearched(true)
    const key = Object.keys(ILLUSTRATIVE_DB).find((item) => value.includes(item))
    setResult(key ? ILLUSTRATIVE_DB[key] : null)
  }

  return (
    <div className="pg">
      <SectionHeader title="البحث القانوني" subtitle="نموذج توضيحي — غير متصل بقاعدة تشريعات موثّقة" />
      <div style={{ background: 'rgba(245,158,11,.07)', border: '1px solid rgba(245,158,11,.2)', borderRadius: 11, padding: '12px 16px', marginBottom: 16, fontSize: '.8rem', color: '#F59E0B', lineHeight: 1.8 }}>
        ⚠️ هذه الصفحة عرض توضيحي (Preview) فقط. لا توجد خلفها قاعدة بيانات تشريعية أو قضائية أردنية حقيقية، ولا نظام استرجاع (RAG) — النتائج المعروضة أدناه أمثلة محدودة مكتوبة يدوياً وليست بحثاً فعلياً. لا تعتمد عليها كمرجع قانوني.
      </div>
      <div className="sb2"><div className="si">⚖️</div><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="هل يجوز فصل الموظف أثناء الإجازة المرضية؟" onKeyDown={(e) => e.key === 'Enter' && search()} /><button className="dbtn dbtn-p" onClick={() => search()}>بحث توضيحي</button></div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
        {['هل يجوز فصل الموظف أثناء الإجازة المرضية؟', 'ما شروط تسجيل شركة ذات مسؤولية محدودة في الأردن؟', 'ما حقوق المستأجر عند طلب الإخلاء؟', 'ما هي إجراءات الاستئناف المدني؟'].map((q) => <button key={q} className="dbtn dbtn-s" style={{ fontSize: '.74rem' }} onClick={() => search(q)}>{q}</button>)}
      </div>
      {searched && (
        result ? (
          <LegalResult title="⚖️ مثال توضيحي — قانون العمل الأردني" mat="مثال يدوي مكتوب مسبقاً، وليس نتيجة بحث فعلية" text={result} why="مطابقة كلمة مفتاحية بسيطة، وليست تحليلاً أو استرجاعاً حقيقياً" />
        ) : (
          <div className="card">
            <div style={{ color: '#64748B', textAlign: 'center', padding: 24 }}>لا يوجد مثال توضيحي مطابق لهذا السؤال. للاستخدام الفعلي يلزم ربط قاعدة تشريعات موثّقة — راجع ARCHITECTURE.md.</div>
          </div>
        )
      )}
    </div>
  )
}
