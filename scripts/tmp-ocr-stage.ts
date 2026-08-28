/**
 * Offline OCR staging for law PDFs whose text layer is intact enough to fool
 * quality.ts but too damaged to index (bidi-reversed runs, ه→ى/و substitution).
 * Renders with pdfjs and reads with tesseract — the same route as
 * src/lib/ingest/ocr.ts, with two deliberate differences:
 *
 *   - no MAX_OCR_PAGES cap. That 40-page ceiling protects a live request from
 *     one 400-page scan; here we are staging a known file offline and a silent
 *     truncation would cost us the last 8 articles of the income tax law.
 *   - a page range, so a 2-page sample can prove OCR is actually better than
 *     the broken text layer before committing ~6s/page to the whole document.
 *
 *   npx tsx --tsconfig scripts/tsconfig.verify.json scripts/tmp-ocr-stage.ts \
 *     <in.pdf> <out.txt> [firstPage] [lastPage]
 */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { createRequire } from "node:module";

// Overridable so a 2-page sample can compare settings before a full run.
// OCR_LANGS defaults to Arabic ALONE, unlike src/lib/ingest/ocr.ts which loads
// ["ara","eng"]: on a pure-Arabic statute the English pack does not add
// coverage, it competes for it — tesseract scores a hard Arabic word as Latin
// and emits "Lelio" where the page says "مواصفاتها". Digits and dates survive
// on "ara" alone, so the English pack costs accuracy and buys nothing here.
const RENDER_SCALE = Number(process.env.OCR_SCALE ?? 3.0);
const OCR_LANGS = (process.env.OCR_LANGS ?? "ara").split("+");
const require = createRequire(import.meta.url);

function standardFontsDir(): string {
  const entry = require.resolve("pdfjs-dist/package.json");
  return `${entry.replace(/package\.json$/, "")}standard_fonts/`;
}

async function main() {
  const [input, output, fromRaw, toRaw] = process.argv.slice(2);
  if (!input || !output) {
    console.error("Usage: tmp-ocr-stage.ts <in.pdf> <out.txt> [firstPage] [lastPage]");
    process.exit(1);
  }

  const { createCanvas } = await import("@napi-rs/canvas");
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const { createWorker } = await import("tesseract.js");

  const doc = await pdfjs.getDocument({
    data: new Uint8Array(await readFile(input)),
    standardFontDataUrl: standardFontsDir(),
    useSystemFonts: false,
    isEvalSupported: false,
  }).promise;

  const first = fromRaw ? Number(fromRaw) : 1;
  const last = toRaw ? Math.min(Number(toRaw), doc.numPages) : doc.numPages;

  console.log(
    `${input}\n  ${doc.numPages} pages, OCR ${first}..${last} @ scale ${RENDER_SCALE}, langs=${OCR_LANGS.join("+")}`
  );

  const worker = await createWorker(OCR_LANGS);
  const out: string[] = [];
  const startedAt = Date.now();

  try {
    for (let i = first; i <= last; i++) {
      const page = await doc.getPage(i);
      const viewport = page.getViewport({ scale: RENDER_SCALE });
      const canvas = createCanvas(viewport.width, viewport.height);
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, viewport.width, viewport.height);

      await page.render({
        canvasContext: ctx as unknown as CanvasRenderingContext2D,
        viewport,
      }).promise;

      const { data } = await worker.recognize(canvas.toBuffer("image/png"));
      out.push(data.text ?? "");
      page.cleanup();

      const done = i - first + 1;
      const total = last - first + 1;
      process.stdout.write(`\r  page ${i}/${last}  (${done}/${total}, ${((Date.now() - startedAt) / 1000).toFixed(0)}s)   `);
    }
  } finally {
    await worker.terminate();
    await doc.destroy();
  }

  const text = out.join("\n\n");
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, text, "utf8");

  const arts = new Set([...text.matchAll(/المادة\s*\(?\s*(\d{1,3})/g)].map((m) => Number(m[1])));
  // Latin runs of 3+ letters are the tell for a language-pack misfire: a
  // Jordanian statute has none, so any hit is an Arabic word read as English.
  const latin = (text.match(/[A-Za-z]{3,}/g) ?? []).length;
  console.log(
    `\n  wrote ${text.length} chars, ${arts.size} distinct articles, ${latin} latin-run(s) -> ${output}`
  );
}

main();
