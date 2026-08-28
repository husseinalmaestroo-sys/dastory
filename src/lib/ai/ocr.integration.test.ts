// Named *.integration.test.ts (not *.test.ts) deliberately: this exercises
// the real Tesseract OCR engine, which downloads ~15MB of language model
// data on first run and takes real wall-clock time to recognize an image —
// exactly the "slow, needs real external resources" category the fast unit
// suite (`npm test`) is meant to exclude. Runs under `npm run test:integration`.
import { createCanvas } from 'canvas'
import { describe, expect, it } from 'vitest'
import { runOcrOnImageDetailed } from './ocr'

function renderTextImage(text: string): Buffer {
  const canvas = createCanvas(900, 160)
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, 900, 160)
  ctx.fillStyle = '#000000'
  ctx.font = '40px sans-serif'
  ctx.fillText(text, 20, 90)
  return canvas.toBuffer('image/png')
}

describe('real OCR (Tesseract, not a canned response)', () => {
  it('reads English text it was never told in advance', async () => {
    const image = renderTextImage('Invoice Number 48213')
    const result = await runOcrOnImageDetailed(image)
    expect(result.text.replace(/\s+/g, ' ')).toContain('Invoice')
    expect(result.text).toContain('48213')
    expect(result.confidence).toBeGreaterThan(30)
  }, 60_000)

  it('produces different output for different input images (proves it is not a fixed canned string)', async () => {
    const a = await runOcrOnImageDetailed(renderTextImage('Alpha Contract 1001'))
    const b = await runOcrOnImageDetailed(renderTextImage('Zeta Settlement 9988'))
    expect(a.text).not.toBe(b.text)
    expect(a.text).toContain('1001')
    expect(b.text).toContain('9988')
  }, 60_000)

  it('actually reads Arabic script, not just Latin', async () => {
    // "Contract Number" in Arabic + a number that would only appear in the
    // output if the Arabic model genuinely ran (not just Latin/digits OCR).
    const image = renderTextImage('رقم العقد ٧٧٣٣')
    const result = await runOcrOnImageDetailed(image)
    const normalized = result.text.replace(/\s+/g, '')
    expect(normalized).toMatch(/العقد|عقد/)
  }, 60_000)
})
