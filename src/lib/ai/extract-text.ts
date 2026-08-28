import { PDFParse } from 'pdf-parse'
import mammoth from 'mammoth'
import { runOcrOnImage } from './ocr'

export class ExtractionError extends Error {}

export interface ExtractedText {
  text: string
  /** How the text was obtained — surfaced to the UI so a user isn't told "AI analyzed your document" when only 40 characters of garbage were actually extracted. */
  method: 'pdf-text-layer' | 'pdf-ocr' | 'docx' | 'ocr' | 'plain-text'
  pageCount?: number
}

const MIN_MEANINGFUL_CHARS = 20
// Caps worst-case resource use from a malicious/pathological upload: a PDF
// crafted with thousands of pages could otherwise force this to rasterize
// and OCR each one in turn, tying up the server for a very long time from
// a single request — the existing per-request rate limit doesn't help
// against one request that itself runs long. Real legal documents rarely
// exceed a fraction of this.
const MAX_OCR_PAGES = 30

/**
 * Extracts real text from an uploaded document's actual bytes — never a
 * placeholder. PDFs with a text layer are read directly (fast, exact); PDFs
 * without one (scanned/image-only) are rasterized page-by-page and run
 * through real OCR. DOCX is parsed structurally. Images go straight to OCR.
 */
export async function extractText(bytes: Buffer, ext: string): Promise<ExtractedText> {
  const type = ext.toUpperCase()

  if (type === 'PDF') {
    const parser = new PDFParse({ data: bytes })
    try {
      const info = await parser.getInfo()
      // pageJoiner: '' — found via a real test with a genuinely blank
      // multi-page PDF: pdf-parse's default pageJoiner ("-- N of total --")
      // is itself enough text to cross MIN_MEANINGFUL_CHARS once there are
      // a couple dozen pages, which would make an actually-empty scanned
      // PDF look like it has a real text layer and skip OCR entirely.
      const result = await parser.getText({ pageJoiner: '' })
      const text = result.text.trim()

      if (text.length >= MIN_MEANINGFUL_CHARS) {
        return { text, method: 'pdf-text-layer', pageCount: info.total }
      }

      if (info.total > MAX_OCR_PAGES) {
        // Refuse outright rather than silently OCR-ing only the first N
        // pages and returning that as if it were the whole document.
        throw new ExtractionError(`هذا الملف ممسوح ضوئياً بلا طبقة نص وعدد صفحاته (${info.total}) يتجاوز الحد المدعوم للتعرف الضوئي (${MAX_OCR_PAGES} صفحة)`)
      }

      // No usable text layer — likely a scanned PDF. Rasterize each page
      // for real and OCR the resulting images, rather than returning near-
      // empty text and pretending analysis happened on it.
      const shots = await parser.getScreenshot({ scale: 2 })
      const ocrParts: string[] = []
      for (const page of shots.pages) {
        if (!page.data) continue
        const pageText = await runOcrOnImage(Buffer.from(page.data))
        if (pageText.trim()) ocrParts.push(pageText.trim())
      }
      const ocrText = ocrParts.join('\n\n').trim()
      if (!ocrText) {
        throw new ExtractionError('تعذّر استخراج أي نص من هذا الملف — تأكد أنه يحتوي نصاً واضحاً أو صورة مقروءة')
      }
      return { text: ocrText, method: 'pdf-ocr', pageCount: info.total }
    } finally {
      await parser.destroy()
    }
  }

  if (type === 'DOCX') {
    const { value } = await mammoth.extractRawText({ buffer: bytes })
    const text = value.trim()
    if (text.length < MIN_MEANINGFUL_CHARS) {
      throw new ExtractionError('المستند لا يحتوي نصاً كافياً للتحليل')
    }
    return { text, method: 'docx' }
  }

  if (type === 'DOC' || type === 'XLS' || type === 'XLSX') {
    throw new ExtractionError('صيغة الملف هذه غير مدعومة للتحليل حالياً — استخدم PDF أو DOCX أو صورة')
  }

  if (type === 'PNG' || type === 'JPG' || type === 'JPEG') {
    const text = (await runOcrOnImage(bytes)).trim()
    if (text.length < MIN_MEANINGFUL_CHARS) {
      throw new ExtractionError('تعذّر استخراج نص مقروء من هذه الصورة')
    }
    return { text, method: 'ocr' }
  }

  if (type === 'TXT') {
    const text = bytes.toString('utf-8').trim()
    if (text.length < MIN_MEANINGFUL_CHARS) throw new ExtractionError('الملف فارغ تقريباً')
    return { text, method: 'plain-text' }
  }

  throw new ExtractionError('نوع الملف غير مدعوم')
}
