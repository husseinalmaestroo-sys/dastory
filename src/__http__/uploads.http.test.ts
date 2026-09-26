// Uploads through the full production request path. Regression for the
// silent-truncation bug: proxy.ts buffers request bodies up to Next's
// proxyClientMaxBodySize (default 10 MB) and used to cut larger uploads short
// — the route then saw a damaged file. next.config.ts now sizes that buffer
// from src/lib/upload-limits.ts, and these tests prove a maximum-size file
// arrives, is stored and comes back byte-for-byte identical.
import { createHash, randomBytes } from 'crypto'
import { beforeAll, describe, expect, it } from 'vitest'
import { MAX_UPLOAD_BYTES } from '@/lib/upload-limits'
import { http, signup, type Actor } from './client'

const sha256 = (buf: Buffer | Uint8Array) => createHash('sha256').update(buf).digest('hex')

function pdfOfSize(size: number): Buffer {
  const buf = randomBytes(size)
  buf.write('%PDF-1.7\n', 0, 'ascii')
  return buf
}

function form(file: Buffer, name: string, type = 'application/pdf', caseId?: string) {
  const fd = new FormData()
  fd.append('file', new Blob([new Uint8Array(file)], { type }), name)
  if (caseId) fd.append('caseId', caseId)
  return fd
}

let owner: Actor
let stranger: Actor

beforeAll(async () => {
  owner = await signup()
  stranger = await signup()
})

describe('document upload through proxy.ts', () => {
  it(`a file of exactly the maximum size (${MAX_UPLOAD_BYTES} bytes) arrives and downloads byte-identical`, async () => {
    const original = pdfOfSize(MAX_UPLOAD_BYTES)
    const res = await http('/api/documents/upload', { actor: owner, body: form(original, 'max-size.pdf') })
    expect(res.status, await res.clone().text()).toBe(200)
    const doc = await res.json()
    expect(doc.size).toBe(MAX_UPLOAD_BYTES)

    const download = await http(`/api/documents/${doc.id}/download`, { actor: owner })
    expect(download.status).toBe(200)
    expect(download.headers.get('cache-control')).toContain('no-store')
    const bytes = Buffer.from(await download.arrayBuffer())
    expect(bytes.length).toBe(original.length)
    expect(sha256(bytes)).toBe(sha256(original))
  })

  it('a file above 10 MB (the old silent-truncation point) also round-trips intact', async () => {
    const original = pdfOfSize(12 * 1024 * 1024 + 7)
    const res = await http('/api/documents/upload', { actor: owner, body: form(original, 'twelve.pdf') })
    expect(res.status).toBe(200)
    const doc = await res.json()
    const bytes = Buffer.from(await (await http(`/api/documents/${doc.id}/download`, { actor: owner })).arrayBuffer())
    expect(sha256(bytes)).toBe(sha256(original))
  })

  it('one byte over the limit is a clean 413', async () => {
    const res = await http('/api/documents/upload', { actor: owner, body: form(pdfOfSize(MAX_UPLOAD_BYTES + 1), 'too-big.pdf') })
    expect(res.status).toBe(413)
    expect((await res.json()).error).toBeTruthy()
  })

  it('a body far beyond the limit is refused with 413, not truncated and stored', async () => {
    const res = await http('/api/documents/upload', { actor: owner, body: form(pdfOfSize(30 * 1024 * 1024), 'huge.pdf') })
    expect(res.status).toBe(413)
    const list = await (await http('/api/documents?q=huge', { actor: owner })).json()
    expect(list).toEqual([])
  })

  it('content that does not match its extension is rejected', async () => {
    const res = await http('/api/documents/upload', { actor: owner, body: form(randomBytes(2048), 'fake.pdf') })
    expect(res.status).toBe(400)
    const exe = await http('/api/documents/upload', { actor: owner, body: form(Buffer.from('MZ\x90\x00'), 'tool.exe', 'application/octet-stream') })
    expect(exe.status).toBe(400)
  })

  it('another office cannot download, read or delete the document', async () => {
    const original = pdfOfSize(4096)
    const doc = await (await http('/api/documents/upload', { actor: owner, body: form(original, 'private.pdf') })).json()
    expect((await http(`/api/documents/${doc.id}/download`, { actor: stranger })).status).toBe(404)
    expect((await http(`/api/documents/${doc.id}`, { method: 'DELETE', actor: stranger })).status).toBe(404)
    expect((await http(`/api/documents/${doc.id}/download`)).status).toBe(401)
    // Still there for its owner.
    const bytes = Buffer.from(await (await http(`/api/documents/${doc.id}/download`, { actor: owner })).arrayBuffer())
    expect(sha256(bytes)).toBe(sha256(original))
  })
})
