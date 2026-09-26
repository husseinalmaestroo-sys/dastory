import { mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, describe, expect, it } from 'vitest'
import { missingOcrModels, OcrUnavailableError, runOcrOnImage } from './ocr'

// OCR used to download its language models from a CDN at request time and
// hang forever when that failed. Now the models are bundled, and a missing
// model is a fast, explicit failure — never a network call, never a hang.
describe('OCR fails fast when its bundled models are missing', () => {
  const original = process.env.OCR_MODELS_DIR
  afterEach(() => {
    if (original === undefined) delete process.env.OCR_MODELS_DIR
    else process.env.OCR_MODELS_DIR = original
  })

  it('reports exactly which models are missing', () => {
    const empty = mkdtempSync(join(tmpdir(), 'ocr-empty-'))
    expect(missingOcrModels(empty)).toEqual(['ara', 'eng'])
  })

  it('rejects immediately with OcrUnavailableError (no worker, no download, no hang)', async () => {
    process.env.OCR_MODELS_DIR = mkdtempSync(join(tmpdir(), 'ocr-empty-'))
    const started = Date.now()
    await expect(runOcrOnImage(Buffer.from([0x89, 0x50, 0x4e, 0x47]))).rejects.toBeInstanceOf(OcrUnavailableError)
    expect(Date.now() - started).toBeLessThan(1000)
  })

  it('the bundled models are installed in this checkout (postinstall)', () => {
    expect(missingOcrModels()).toEqual([])
  })
})
