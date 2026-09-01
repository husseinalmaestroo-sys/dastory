// *.integration.test.ts: real pdf.js text extraction + real OCR fallback,
// not mocked — see ocr.integration.test.ts for why this tier exists.
import { createCanvas } from 'canvas'
import { describe, expect, it } from 'vitest'
import { extractText } from './extract-text'

/** A real, valid PDF (Cairo's PDF surface via node-canvas), genuinely rasterized and OCR'd — proves the pdf-parse + OCR pipeline runs end to end on real PDF bytes, not a mock. */
function renderPdf(text: string): Buffer {
  const canvas = createCanvas(600, 150, 'pdf')
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, 600, 150)
  ctx.fillStyle = '#000000'
  ctx.font = '28px sans-serif'
  ctx.fillText(text, 20, 60)
  return canvas.toBuffer()
}

describe('real PDF text extraction (pdf.js + OCR, not mocked)', () => {
  it('extracts real, correct text from an actual PDF file end to end', async () => {
    const pdf = renderPdf('Case Reference Number 4471')
    const result = await extractText(pdf, 'PDF')
    // Cairo's PDF surface (via node-canvas) does not embed a proper
    // selectable text layer for fillText — pdf.js correctly reports no
    // extractable text, and extractText() correctly falls back to
    // rasterizing the page and running real OCR on it. Both outcomes prove
    // the pipeline is genuine: either the text layer is read directly, or
    // the OCR fallback actually runs and actually reads the page image.
    expect(['pdf-text-layer', 'pdf-ocr']).toContain(result.method)
    expect(result.text).toContain('4471')
  }, 60_000)

  it('the OCR fallback path specifically produces real, distinguishable text for different PDFs', async () => {
    // Numbers with distinct digit glyphs — a run of 1s and 0s ("1001") is a
    // classic OCR failure at this render size and makes the assertion flaky
    // for no gain: the point is "OCR reads *this* page, not a mock", which
    // any legible distinct string proves.
    const a = await extractText(renderPdf('Alpha Reference 3527'), 'PDF')
    const b = await extractText(renderPdf('Zeta Reference 8461'), 'PDF')
    expect(a.method).toBe('pdf-ocr')
    expect(b.method).toBe('pdf-ocr')
    expect(a.text).not.toBe(b.text)
    expect(a.text).toContain('3527')
    expect(b.text).toContain('8461')
  }, 60_000)

  it('rejects a PDF with no usable content instead of fabricating a result', async () => {
    const blankPdf = createCanvas(200, 100, 'pdf').toBuffer()
    await expect(extractText(blankPdf, 'PDF')).rejects.toThrow()
  }, 30_000)

  it('refuses a scanned PDF with too many pages instead of OCR-ing an unbounded number of them (resource-exhaustion guard)', async () => {
    // 31 blank pages — one over MAX_OCR_PAGES. Deliberately blank/tiny: this
    // must reject before attempting any OCR work, so the test itself stays
    // fast regardless of the page count.
    const canvas = createCanvas(100, 100, 'pdf')
    const ctx = canvas.getContext('2d')
    for (let i = 0; i < 31; i++) {
      if (i > 0) ctx.addPage()
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(0, 0, 100, 100)
    }
    const bigPdf = canvas.toBuffer()

    await expect(extractText(bigPdf, 'PDF')).rejects.toThrow(/يتجاوز الحد المدعوم/)
  }, 30_000)
})
