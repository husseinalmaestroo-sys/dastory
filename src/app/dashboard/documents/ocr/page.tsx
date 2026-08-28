'use client'

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Badge, SectionHeader } from '@/components/dashboard/ui'

const METHOD_LABEL: Record<string, string> = {
  'pdf-text-layer': 'طبقة نص PDF',
  'pdf-ocr': 'تعرّف ضوئي (OCR) — PDF ممسوح ضوئياً',
  ocr: 'تعرّف ضوئي حقيقي (Tesseract، عربي + إنجليزي)',
  docx: 'مستند Word',
  'plain-text': 'نص عادي',
}

export default function OcrPage() {
  const router = useRouter()
  const fileRef = useRef<HTMLInputElement | null>(null)
  const [busy, setBusy] = useState<'uploading' | 'processing' | null>(null)
  const [error, setError] = useState('')
  const [fileName, setFileName] = useState('')
  const [text, setText] = useState('')
  const [method, setMethod] = useState('')

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return

    setError(''); setText(''); setFileName(file.name)
    setBusy('uploading')
    try {
      const fd = new FormData()
      fd.append('file', file)
      const uploadRes = await fetch('/api/documents/upload', { method: 'POST', body: fd })
      const uploaded = await uploadRes.json()
      if (!uploadRes.ok) { setError(uploaded.error || 'فشل رفع الملف'); return }

      setBusy('processing')
      const ocrRes = await fetch(`/api/documents/${uploaded.id}/ocr`, { method: 'POST' })
      const ocrData = await ocrRes.json()
      if (!ocrRes.ok) { setError(ocrData.error || 'تعذّر استخراج النص'); return }
      setText(ocrData.text)
      setMethod(ocrData.method)
    } catch {
      setError('تعذّر الاتصال بالخادم')
    } finally {
      setBusy(null)
    }
  }

  const copyText = () => { if (text) navigator.clipboard.writeText(text) }

  return (
    <div className="pg">
      <SectionHeader title="تحويل الصور والمستندات إلى نص (OCR)" subtitle="تعرّف ضوئي حقيقي (Tesseract) — يدعم العربية والإنجليزية" />
      <div className="g2">
        <div className="card">
          <div className="ct">📷 رفع الملف</div>
          <input ref={fileRef} type="file" accept=".png,.jpg,.jpeg,.pdf" style={{ display: 'none' }} onChange={handleFile} />
          <button className="upl" onClick={() => fileRef.current?.click()} disabled={!!busy}>
            <div className="uic">📷</div>
            <div className="ut">
              {busy === 'uploading' ? 'جارٍ رفع الملف...' : busy === 'processing' ? 'جارٍ التعرّف الضوئي على الحروف...' : (fileName || 'ارفع صورة أو PDF ممسوح ضوئياً')}
            </div>
            <div className="uh">JPG · PNG · PDF · حتى 20MB</div>
          </button>
          {error && <div style={{ color: '#F87171', fontSize: '.8rem', marginTop: 10 }}>⚠ {error}</div>}
          <div style={{ marginTop: 12, fontSize: '.74rem', color: '#64748B', lineHeight: 1.7 }}>
            لملفات PDF: يُقرأ النص مباشرة إن كان متوفراً في الملف، وإلا يُشغَّل تعرّف ضوئي حقيقي على كل صفحة كصورة ممسوحة.
          </div>
        </div>
        {text && (
          <div className="card">
            <div className="ct">📝 النص المستخرج {method && <Badge type="ac">{METHOD_LABEL[method] ?? method}</Badge>}</div>
            <textarea className="fi" readOnly style={{ minHeight: 260, fontSize: '.82rem', lineHeight: 1.8 }} value={text} />
            <div style={{ marginTop: 10, display: 'flex', gap: 7 }}>
              <button className="dbtn dbtn-p" onClick={() => router.push('/dashboard/ai/contract')}>🔍 حلّل هذا الملف بالذكاء الاصطناعي</button>
              <button className="dbtn dbtn-s" onClick={copyText}>📋 نسخ النص</button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
