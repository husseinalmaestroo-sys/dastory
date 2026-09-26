#!/usr/bin/env node
// Copies the Tesseract language models bundled as npm dependencies
// (@tesseract.js-data/ara, @tesseract.js-data/eng) into one directory,
// `ocr-models/`, which src/lib/ai/ocr.ts uses as tesseract.js's local
// `langPath`. tesseract.js reads every language from a single langPath, while
// the npm packages keep each model in its own folder — hence the copy.
//
// Without this, tesseract.js downloads the models from cdn.jsdelivr.net at
// first use, which made OCR depend on an outbound CDN at request time (and
// hang when it was unreachable). Runs from `postinstall` and from the
// Dockerfile's build stage. Idempotent.
import { copyFileSync, existsSync, mkdirSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const outDir = process.env.OCR_MODELS_DIR || join(root, 'ocr-models')
const LANGS = ['ara', 'eng']
// LSTM-only integer models — the same variant tesseract.js would otherwise
// fetch from the CDN by default.
const VARIANT = '4.0.0_best_int'

mkdirSync(outDir, { recursive: true })
let missing = 0
for (const lang of LANGS) {
  const src = join(root, 'node_modules', '@tesseract.js-data', lang, VARIANT, `${lang}.traineddata.gz`)
  const dest = join(outDir, `${lang}.traineddata.gz`)
  if (!existsSync(src)) {
    console.error(`[prepare-ocr-models] missing ${src} — is @tesseract.js-data/${lang} installed?`)
    missing++
    continue
  }
  if (!existsSync(dest) || statSync(dest).size !== statSync(src).size) copyFileSync(src, dest)
}
if (missing) process.exit(1)
console.log(`[prepare-ocr-models] ${LANGS.join('+')} models ready in ${outDir}`)
