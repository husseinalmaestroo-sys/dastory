import "server-only";

/**
 * OCR for scanned PDFs: render each page with pdfjs onto a napi-rs canvas,
 * then read it with tesseract (Arabic + English).
 *
 * Pure npm — no poppler/imagemagick/ghostscript to install on the VPS, which
 * is the whole reason for this route over the usual pdf2pic stack.
 */

// Rendering scale. 3.0 ≈ 220dpi. Higher than the usual 150dpi advice because
// the job here is Arabic-Indic digits inside parentheses — "(٣)" — which are
// small, and a misread digit is a fabricated article number, the one output
// this system must never produce. The extra RAM is worth that.
const RENDER_SCALE = 3.0;

// Hard cap. OCR runs ~5-8s/page single-threaded; without a ceiling one 400-page
// scan pins the CPU for half an hour and starves every other request.
const MAX_OCR_PAGES = 40;

/**
 * Filesystem path to pdfjs' bundled standard fonts, resolved off the package
 * itself rather than hardcoded — node_modules layout differs between npm,
 * pnpm and a Docker image, and a wrong path fails silently as unrendered text.
 */
function standardFontsDir(): string {
  const entry = require.resolve("pdfjs-dist/package.json");
  return `${entry.replace(/package\.json$/, "")}standard_fonts/`;
}

export async function ocrPdf(buffer: Buffer): Promise<{ text: string; pages: number }> {
  const { createCanvas } = await import("@napi-rs/canvas");
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const { createWorker } = await import("tesseract.js");

  const doc = await pdfjs.getDocument({
    data: new Uint8Array(buffer),
    // Without this, pdfjs cannot draw the 14 standard PDF fonts and silently
    // skips those glyphs — the page renders with holes and OCR reads the holes
    // as noise. It matters most for exactly the characters we care about:
    // digits and parentheses in Helvetica/Times runs.
    standardFontDataUrl: standardFontsDir(),
    // No DOM here — these keep pdfjs on its pure-JS paths under Node.
    useSystemFonts: false,
    isEvalSupported: false,
  }).promise;

  const pageCount = Math.min(doc.numPages, MAX_OCR_PAGES);
  const worker = await createWorker(["ara", "eng"]);
  const out: string[] = [];

  try {
    for (let i = 1; i <= pageCount; i++) {
      const page = await doc.getPage(i);
      const viewport = page.getViewport({ scale: RENDER_SCALE });
      const canvas = createCanvas(viewport.width, viewport.height);
      const ctx = canvas.getContext("2d");

      // White ground: PDFs render transparent, and tesseract reads
      // transparent-on-black as noise.
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, viewport.width, viewport.height);

      await page.render({
        canvasContext: ctx as unknown as CanvasRenderingContext2D,
        viewport,
      }).promise;

      const { data } = await worker.recognize(canvas.toBuffer("image/png"));
      out.push(data.text ?? "");
      page.cleanup();
    }
  } finally {
    await worker.terminate();
    await doc.destroy();
  }

  if (doc.numPages > MAX_OCR_PAGES) {
    console.warn(`[ocr] truncated: read ${MAX_OCR_PAGES} of ${doc.numPages} pages`);
  }

  return { text: out.join("\n\n"), pages: pageCount };
}
