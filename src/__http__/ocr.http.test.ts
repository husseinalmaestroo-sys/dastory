// OCR on the production server layout. tesseract.js loads its worker script,
// WASM core and language models by file path at runtime — none of which
// `next build` output tracing follows — so this is the test that proves
// scripts/assemble-standalone.mjs (which the Docker image uses too) ships
// everything OCR needs, and that it works with no network access to a CDN.
import { createCanvas } from 'canvas'
import { beforeAll, describe, expect, it } from 'vitest'
import { http, signup, type Actor } from './client'

function textImage(text: string): Buffer {
  const canvas = createCanvas(900, 160)
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, 900, 160)
  ctx.fillStyle = '#000000'
  ctx.font = '40px sans-serif'
  ctx.fillText(text, 20, 90)
  return canvas.toBuffer('image/png')
}

/** A minimal, valid one-page PDF whose text layer contains `text`. */
function textPdf(text: string): Buffer {
  const stream = `BT /F1 18 Tf 40 100 Td (${text}) Tj ET`
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 200] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ]
  let pdf = '%PDF-1.4\n'
  const offsets: number[] = []
  objects.forEach((body, i) => {
    offsets.push(pdf.length)
    pdf += `${i + 1} 0 obj\n${body}\nendobj\n`
  })
  const xref = pdf.length
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  pdf += offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return Buffer.from(pdf, 'latin1')
}

async function upload(actor: Actor, bytes: Buffer, name: string, type: string) {
  const fd = new FormData()
  fd.append('file', new Blob([new Uint8Array(bytes)], { type }), name)
  const res = await http('/api/documents/upload', { actor, body: fd })
  expect(res.status).toBe(200)
  return res.json() as Promise<{ id: string }>
}

let owner: Actor
beforeAll(async () => {
  owner = await signup()
})

describe('PDF text extraction through the HTTP path (pdf-parse / pdfjs in the bundle)', () => {
  it('reads the text layer of an uploaded PDF', async () => {
    const doc = await upload(owner, textPdf('Service agreement number 77431 between the two parties'), 'agreement.pdf', 'application/pdf')
    const res = await http(`/api/documents/${doc.id}/ocr`, { method: 'POST', actor: owner, json: {} })
    const body = await res.json()
    expect(res.status, JSON.stringify(body)).toBe(200)
    expect(body.method).toBe('pdf-text-layer')
    expect(body.text).toContain('77431')
  })

  it('the AI document routes load (they import the same extractor): unverified caller gets 403, not 500', async () => {
    const doc = await upload(owner, textPdf('Lease contract 1188 for review by counsel today'), 'lease.pdf', 'application/pdf')
    for (const path of ['/api/ai/contract-review', '/api/ai/case-analysis']) {
      const res = await http(path, { actor: owner, json: { documentId: doc.id } })
      expect(res.status, path).toBe(403)
      expect((await res.json()).code, path).toBe('email_not_verified')
    }
  })
})

describe('OCR through the HTTP path', () => {
  it('reads text from an uploaded image with the bundled models', async () => {
    const fd = new FormData()
    fd.append('file', new Blob([new Uint8Array(textImage('Receipt Number 55721'))], { type: 'image/png' }), 'scan.png')
    const up = await http('/api/documents/upload', { actor: owner, body: fd })
    expect(up.status).toBe(200)
    const doc = await up.json()

    const started = Date.now()
    const res = await http(`/api/documents/${doc.id}/ocr`, { method: 'POST', actor: owner, json: {} })
    const body = await res.json()
    expect(res.status, JSON.stringify(body)).toBe(200)
    expect(body.method).toBe('ocr')
    expect(body.text).toContain('55721')
    expect(Date.now() - started).toBeLessThan(45_000)
  })
})
