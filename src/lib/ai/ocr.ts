import { existsSync } from 'fs'
import { join } from 'path'
import { createWorker, type Worker } from 'tesseract.js'

// Real OCR — Tesseract's actual LSTM engine running server-side, not a
// canned response. Arabic + English trained models cover the primary case
// (Jordanian legal documents, which routinely mix Arabic body text with
// Latin-script names/numbers/citations).
const LANGS = ['ara', 'eng']

// The language models ship with the app — `@tesseract.js-data/{ara,eng}` npm
// dependencies, copied into one `ocr-models/` directory by
// scripts/prepare-ocr-models.mjs (postinstall, and the Dockerfile's build
// stage). tesseract.js is pointed at that local directory, so OCR never
// reaches out to a CDN at request time. It used to: models were fetched from
// cdn.jsdelivr.net on first use, and when that host was unreachable the
// request hung forever (tesseract.js swallows a language-load failure in
// its init chain and never settles the createWorker promise).
export function ocrModelsDir(): string {
  return process.env.OCR_MODELS_DIR || join(process.cwd(), 'ocr-models')
}

export function missingOcrModels(dir = ocrModelsDir()): string[] {
  return LANGS.filter((lang) => !existsSync(join(dir, `${lang}.traineddata.gz`)))
}

// Loading ~4.5 MB of local models takes a second or two; 20s means the
// engine is broken, not slow.
export const OCR_INIT_TIMEOUT_MS = 20_000
// One scanned page at scale 2 normally takes a few seconds.
export const OCR_PAGE_TIMEOUT_MS = 45_000

/** OCR engine can't run at all on this server (models missing, engine failed to load). */
export class OcrUnavailableError extends Error {}
/** OCR started but exceeded its time budget. */
export class OcrTimeoutError extends Error {}

export interface OcrPageResult {
  text: string
  confidence: number
}

function withTimeout<T>(promise: Promise<T>, ms: number, onTimeout: () => Error): Promise<T> {
  let timer: NodeJS.Timeout | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(onTimeout()), ms)
  })
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer))
}

async function startWorker(): Promise<Worker> {
  const dir = ocrModelsDir()
  const missing = missingOcrModels(dir)
  if (missing.length > 0) {
    // Fail before spawning a worker thread at all — nothing to clean up.
    throw new OcrUnavailableError(`OCR language models not installed (${missing.join(', ')}) in ${dir}`)
  }

  // tesseract.js reports a failed language load through `errorHandler` but
  // leaves the createWorker() promise pending; surface it ourselves.
  let rejectLoad: (err: Error) => void = () => {}
  const loadFailed = new Promise<never>((_, reject) => { rejectLoad = reject })
  const workerPromise = createWorker(LANGS, undefined, {
    langPath: dir,
    gzip: true,
    cacheMethod: 'none',
    errorHandler: (err: unknown) => rejectLoad(new OcrUnavailableError(`OCR engine failed: ${String(err)}`)),
  })

  try {
    return await withTimeout(
      Promise.race([workerPromise, loadFailed]),
      OCR_INIT_TIMEOUT_MS,
      () => new OcrUnavailableError(`OCR engine did not start within ${OCR_INIT_TIMEOUT_MS}ms`)
    )
  } catch (err) {
    // If the worker does come up later, don't leak its thread.
    workerPromise.then((w) => w.terminate()).catch(() => {})
    throw err
  }
}

/**
 * Runs `fn` with one OCR worker, reused across every image `fn` recognizes
 * (a multi-page scanned PDF loads the models once, not once per page), and
 * always terminates it afterwards — including after a timeout.
 */
export async function withOcrWorker<T>(
  fn: (recognize: (imageBytes: Buffer) => Promise<OcrPageResult>) => Promise<T>
): Promise<T> {
  const worker = await startWorker()
  try {
    return await fn(async (imageBytes) => {
      const { data } = await withTimeout(
        worker.recognize(imageBytes),
        OCR_PAGE_TIMEOUT_MS,
        () => new OcrTimeoutError(`OCR of one page exceeded ${OCR_PAGE_TIMEOUT_MS}ms`)
      )
      return { text: data.text ?? '', confidence: data.confidence ?? 0 }
    })
  } finally {
    await worker.terminate().catch(() => {})
  }
}

/** Runs real OCR on one image's bytes (PNG/JPG, or a rasterized PDF page). */
export async function runOcrOnImage(imageBytes: Buffer): Promise<string> {
  const result = await runOcrOnImageDetailed(imageBytes)
  return result.text
}

export async function runOcrOnImageDetailed(imageBytes: Buffer): Promise<OcrPageResult> {
  return withOcrWorker((recognize) => recognize(imageBytes))
}
