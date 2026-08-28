import "server-only";
import { readFile } from "node:fs/promises";
import { extname } from "node:path";
import { assessArabicText } from "./quality";

export type ExtractResult = {
  text: string;
  pages: number;
  method: "text-layer" | "ocr" | "hybrid" | "plain-text";
  /** Set when we rejected the text layer and OCR'd instead. Surfaced to the admin. */
  note?: string;
};

/**
 * Reads a source file into text, dispatching on extension.
 *
 * `.txt` exists as a first-class input because the highest-quality legal
 * sources are not PDFs: the Judicial Council publishes binding interpretations
 * as HTML, which converts to text with correct digits and no font-map damage.
 * Forcing that through a PDF round-trip would destroy the one input we have
 * that needs no repair.
 */
export async function extractDocument(filePath: string): Promise<ExtractResult> {
  const ext = extname(filePath).toLowerCase();

  if (ext === ".txt") {
    const text = await readFile(filePath, "utf8");
    // No quality gate: this text never passed through a font map, so it has
    // no way to be mojibake. If it is garbage, it was garbage at the source.
    return { text, pages: 1, method: "plain-text" };
  }

  if (ext === ".pdf") return extractPdfText(await readFile(filePath));

  throw new Error(`Unsupported file type "${ext}". Supported: .pdf, .txt`);
}

/** Below this many chars per page, we treat the text layer as absent (scanned PDF). */
const MIN_CHARS_PER_PAGE = 80;

/**
 * Extracts text from a PDF buffer.
 *
 * Two gates, and the second one is the important one for Arabic:
 *
 *  1. Density — is there a text layer at all? Catches plain scans.
 *  2. Quality — is the text layer *real Arabic*? Catches the far nastier case
 *     where the PDF has a dense text layer built on a broken font encoding.
 *     Jordanian Official Gazette PDFs do exactly this: they extract as
 *     "اٌّبصح 3 - ٠ـّٝ ٘ظا اٌمابْٔٛ" instead of "المادة 1 - يسمى هذا القانون".
 *
 * Density alone would pass that garbage straight into the index — it is dense,
 * it is Arabic script, and every downstream stage would accept it. Nothing
 * would fail; retrieval would just quietly never match anything. Hence gate 2.
 */
export async function extractPdfText(buffer: Buffer): Promise<ExtractResult> {
  const parsed = await parseTextLayer(buffer);
  const pages = Math.max(parsed.pages, 1);
  const density = parsed.text.trim().length / pages;

  if (density >= MIN_CHARS_PER_PAGE) {
    const quality = assessArabicText(parsed.text);
    if (!quality.garbled) {
      return { text: parsed.text, pages, method: "text-layer" };
    }

    // Dense but broken. OCR is the only way to read this file: rendering the
    // page and reading the pixels bypasses the font's bad character map
    // entirely, because it never consults it.
    console.warn(`[extract] rejecting text layer — ${quality.reason}`);
    const ocr = await runOcr(buffer);
    return {
      text: ocr.text,
      pages: ocr.pages,
      method: "ocr",
      // The garbled layer is deliberately discarded rather than concatenated:
      // merging it in would inject unsearchable noise into every chunk and
      // could be quoted to a lawyer as if it were statute text.
      note: "تم تجاهل النص المدمج في الملف لأن ترميز الخط تالف، واستُخدم التعرّف الضوئي (OCR) بدلاً منه.",
    };
  }

  // Scanned or image-only.
  const ocr = await runOcr(buffer);

  // Keep whatever the text layer did give us — some PDFs are a scan with a
  // real text header, and throwing that away loses the cleanest text we have.
  // Only when that header is itself trustworthy, though.
  if (parsed.text.trim().length > 0 && !assessArabicText(parsed.text).garbled) {
    return { text: `${parsed.text}\n\n${ocr.text}`.trim(), pages, method: "hybrid" };
  }
  return { text: ocr.text, pages: ocr.pages, method: "ocr" };
}

/** OCR is imported lazily: tesseract + canvas pull in ~100MB most files never need. */
async function runOcr(buffer: Buffer) {
  const { ocrPdf } = await import("./ocr");
  return ocrPdf(buffer);
}

async function parseTextLayer(buffer: Buffer): Promise<{ text: string; pages: number }> {
  // Import the lib entrypoint directly: pdf-parse's index.js runs a debug
  // block that reads a test PDF off disk at import time and throws in a
  // bundled/production context.
  const mod = await import("pdf-parse/lib/pdf-parse.js");
  const pdfParse = (mod.default ?? mod) as (b: Buffer) => Promise<{ text: string; numpages: number }>;

  try {
    const data = await pdfParse(buffer);
    return { text: data.text ?? "", pages: data.numpages ?? 1 };
  } catch (err) {
    // A corrupt text layer is not fatal — OCR may still read the pages.
    console.warn("[extract] text layer failed, will try OCR:", (err as Error).message);
    return { text: "", pages: 1 };
  }
}
