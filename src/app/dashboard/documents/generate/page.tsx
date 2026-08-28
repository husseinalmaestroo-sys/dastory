'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Field, SectionHeader } from '@/components/dashboard/ui'

export default function DocGenPage() {
  const router = useRouter()
  const [selected, setSelected] = useState('مذكرة دفاع')
  const [plaintiff, setPlaintiff] = useState('')
  const [defendant, setDefendant] = useState('')
  const [court, setCourt] = useState('بداية عمّان المدنية')
  const [caseNum, setCaseNum] = useState('')
  const [subject, setSubject] = useState('')
  const [generated, setGenerated] = useState(false)

  const docTypes = [['📋', 'صحيفة دعوى'], ['📩', 'لائحة جوابية'], ['🛡️', 'مذكرة دفاع'], ['⚠️', 'إنذار عدلي'], ['📜', 'وكالة قانونية'], ['🤝', 'عقد']]

  const getContent = () => {
    const date = new Date().toLocaleDateString('ar-JO', { year: 'numeric', month: 'long', day: 'numeric' })
    const p = plaintiff || '___'; const d = defendant || '___'; const s = subject || '___'; const n = caseNum || 'XXXX/2026'
    const map: Record<string, string> = {
      'صحيفة دعوى': `بسم الله الرحمن الرحيم\nالمملكة الأردنية الهاشمية — محكمة ${court}\n\nصحيفة دعوى — رقم ${n}\n\nالطرف الأول (المدعي): ${p}\nالطرف الثاني (المدعى عليه): ${d}\n\nالموضوع:\n${s}\n\nيرجو المدعي التفضل بالنظر في دعواه وفق الأصول القانونية والحكم لصالحه.\n\nعمّان، ${date}\n\nتوقيع المحامي: ___________`,
      'لائحة جوابية': `بسم الله الرحمن الرحيم\nالمملكة الأردنية الهاشمية — محكمة ${court}\n\nلائحة جوابية — القضية رقم ${n}\n\nالمدعي: ${p}\nالمدعى عليه: ${d}\n\nبالإشارة إلى لائحة الدعوى، نرد عليها ونفنّدها:\n${s}\n\nنلتمس من عدالة المحكمة رد الدعوى لعدم الصحة وإلزام المدعي بالرسوم.\n\nعمّان، ${date}`,
      'مذكرة دفاع': `بسم الله الرحمن الرحيم\nالمملكة الأردنية الهاشمية — محكمة ${court}\n\nمذكرة دفاع — القضية رقم ${n}\n\nالموكل: ${p}\nالخصم: ${d}\n\nأولاً — من حيث الوقائع:\n${s}\n\nثانياً — من حيث القانون:\nاستناداً لأحكام القانون الأردني المعمول به، يثبت للموكل حقه الكامل.\n\nالطلب: إصدار الحكم لصالح الموكل مع إلزام الخصم بالرسوم وأتعاب المحاماة.\n\nعمّان، ${date}`,
      'إنذار عدلي': `بسم الله الرحمن الرحيم\nإنذار عدلي\n\nأنا الموقّع أدناه، ${p}، أُنذر السيد / ${d} بما يلي:\n${s}\n\nوأُحذّره من مغبّة الإخلال بالتزاماته، مع الاحتفاظ بكامل حقوقي القانونية.\n\nعمّان، ${date}`,
      'وكالة قانونية': `بسم الله الرحمن الرحيم\nوكالة قانونية\n\nأنا الموكّل: ${p}\nأوكّل وأُفوّض المحامي / ${d}\n\nللنيابة عني في: ${s}\n\nوذلك أمام محكمة ${court} ودرجاتها المختلفة.\n\nصدر هذا التوكيل بتاريخ: ${date}\n\nتوقيع الموكّل: ___________`,
      'عقد': `بسم الله الرحمن الرحيم\nعقد\n\nمحرّر في عمّان بتاريخ: ${date}\n\nالطرف الأول: ${p}\nالطرف الثاني: ${d}\n\nالموضوع: ${s}\n\nاتفق الطرفان على البنود المذكورة، وتعهّد كل منهما بالالتزام بها وفق أحكام القانون الأردني.\n\nتوقيع الطرف الأول: ___________     توقيع الطرف الثاني: ___________`,
    }
    return map[selected] ?? `مستند: ${selected}\n\nالطرف الأول: ${p}\nالطرف الثاني: ${d}\n\n${s}`
  }

  const printDoc = () => {
    const content = getContent()
    const win = window.open('', '_blank', 'width=800,height=900')
    if (!win) return
    win.document.write(`<!DOCTYPE html><html dir="rtl"><head><meta charset="utf-8"><title>${selected}</title><style>body{font-family:Arial,sans-serif;font-size:14pt;line-height:2;padding:60px 80px;color:#000;direction:rtl;white-space:pre-wrap}@page{margin:2cm}@media print{body{padding:0}}</style></head><body>${content.replace(/\n/g, '<br>')}</body></html>`)
    win.document.close()
    setTimeout(() => { win.focus(); win.print() }, 400)
  }

  const copyDoc = () => { navigator.clipboard.writeText(getContent()) }

  return (
    <div className="pg">
      <SectionHeader title="إنشاء المستندات القانونية" subtitle="توليد مستندات احترافية في ثوانٍ" />
      <div className="g3" style={{ marginBottom: 16 }}>
        {docTypes.map(([icon, label]) => (
          <button key={label} className={`ctc${selected === label ? ' sel' : ''}`} onClick={() => { setSelected(label); setGenerated(false) }}>
            <div className="ctci">{icon}</div><div className="ctcl">{label}</div>
          </button>
        ))}
      </div>
      <div className="g2">
        <div className="card">
          <div className="ct">📝 بيانات المستند</div>
          <div className="fg">
            <Field label="المدعي / الموكل / الطرف الأول"><input className="fi" value={plaintiff} onChange={e => setPlaintiff(e.target.value)} placeholder="الاسم الكامل" /></Field>
            <Field label="المدعى عليه / الخصم / الطرف الثاني"><input className="fi" value={defendant} onChange={e => setDefendant(e.target.value)} placeholder="الاسم الكامل" /></Field>
            <Field label="المحكمة">
              <select className="fi" value={court} onChange={e => setCourt(e.target.value)}>
                <option>بداية عمّان المدنية</option><option>استئناف عمّان</option><option>محكمة التمييز</option>
                <option>تجارية عمّان</option><option>صلح عمّان</option><option>شرعية عمّان</option>
              </select>
            </Field>
            <Field label="رقم القضية"><input className="fi" value={caseNum} onChange={e => setCaseNum(e.target.value)} placeholder="2026/XXXX" /></Field>
            <Field label="الموضوع / التفاصيل" full>
              <textarea className="fi" style={{ minHeight: 100 }} value={subject} onChange={e => setSubject(e.target.value)} placeholder="اشرح موضوع المستند..." />
            </Field>
          </div>
          <button className="dbtn dbtn-p" style={{ marginTop: 10 }} onClick={() => setGenerated(true)}>✨ توليد المستند</button>
        </div>
        <div className="card">
          <div className="ct">👁️ المعاينة</div>
          <div style={{ background: '#fff', borderRadius: 8, padding: 16, minHeight: 220, color: '#1E293B', fontSize: '.8rem', lineHeight: 1.9 }}>
            {generated
              ? <pre style={{ whiteSpace: 'pre-wrap', margin: 0, fontFamily: 'inherit', fontSize: '.8rem', lineHeight: 1.9 }}>{getContent()}</pre>
              : <div style={{ textAlign: 'center', color: '#94A3B8', marginTop: 24 }}>أدخل البيانات واضغط "توليد المستند"</div>
            }
          </div>
          {generated && (
            <div style={{ marginTop: 10, display: 'flex', gap: 7 }}>
              <button className="dbtn dbtn-p" onClick={printDoc}>🖨️ طباعة / PDF</button>
              <button className="dbtn dbtn-s" onClick={copyDoc}>📋 نسخ</button>
              <button className="dbtn dbtn-s" onClick={() => router.push('/dashboard/documents/sign')}>🖊️ توقيع</button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
