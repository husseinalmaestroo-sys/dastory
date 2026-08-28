import { createWorker } from 'tesseract.js'
import { join } from 'path'

// Real OCR — Tesseract's actual LSTM engine running server-side, not a
// canned response. Arabic + English trained models cover the primary case
// (Jordanian legal documents, which routinely mix Arabic body text with
// Latin-script names/numbers/citations).
const LANGS = ['ara', 'eng']

// Language model files (~a few MB each) are fetched once from Tesseract's
// CDN on first use and cached here so every later call is fully local — not
// tracked by git (see .gitignore's storage/ entry).
const OCR_CACHE_DIR = join(process.cwd(), 'storage', '.ocr-cache')

export interface OcrPageResult {
  text: string
  confidence: number
}

/** Runs real OCR on one image's bytes (PNG/JPG, or a rasterized PDF page). */
export async function runOcrOnImage(imageBytes: Buffer): Promise<string> {
  const result = await runOcrOnImageDetailed(imageBytes)
  return result.text
}

export async function runOcrOnImageDetailed(imageBytes: Buffer): Promise<OcrPageResult> {
  const worker = await createWorker(LANGS, undefined, { cachePath: OCR_CACHE_DIR })
  try {
    const { data } = await worker.recognize(imageBytes)
    return { text: data.text ?? '', confidence: data.confidence ?? 0 }
  } finally {
    await worker.terminate()
  }
}
