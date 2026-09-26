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

let owner: Actor
beforeAll(async () => {
  owner = await signup()
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
