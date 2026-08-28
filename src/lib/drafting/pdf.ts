import "server-only";
import type { Browser } from "puppeteer";
import { parseDraft, splitCitations, type DocLine } from "./parse";

/**
 * Renders the marker-formatted draft (see FORMAT_RULES in ai/prompts.ts) to a
 * printable PDF via headless Chromium.
 *
 * Arabic legal text needs real glyph shaping (letters join differently in
 * initial/medial/final position) and bidi ordering (Arabic prose with embedded
 * Latin case numbers and [1]-style citations). Pure-JS PDF libraries (pdfkit,
 * pdf-lib) don't do either — they draw isolated-form glyphs one codepoint at a
 * time, which renders Arabic as disconnected letters. A browser's text layout
 * engine already does this correctly, and it's the same engine that renders
 * DraftPaper on screen, so printing that layout is the one approach that can't
 * drift from what the lawyer already reviewed.
 */

let browserPromise: Promise<Browser> | null = null;

/** One Chromium process for the life of the server, not one per request. */
function getBrowser(): Promise<Browser> {
  if (!browserPromise) {
    browserPromise = import("puppeteer").then(({ default: puppeteer }) =>
      puppeteer.launch({
        headless: true,
        args: ["--no-sandbox", "--disable-setuid-sandbox"],
      })
    );
    // A launch failure must not poison every request after it — let the next
    // caller retry instead of getting a permanently-rejected promise.
    browserPromise.catch(() => {
      browserPromise = null;
    });
  }
  return browserPromise;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function runsHtml(text: string): string {
  return splitCitations(text)
    .map((part) =>
      part.cite ? `<sup class="cite">[${escapeHtml(part.text)}]</sup>` : escapeHtml(part.text)
    )
    .join("");
}

function lineHtml(line: DocLine): string {
  switch (line.type) {
    case "header":
      return `<p class="header">${runsHtml(line.text)}</p>`;
    case "heading":
      return `<p class="heading">${runsHtml(line.text)}</p>`;
    case "signature":
      return `<p class="signature">${runsHtml(line.text)}</p>`;
    case "blank":
      return "";
    default:
      return `<p class="body">${runsHtml(line.text)}</p>`;
  }
}

function draftHtml(draft: string): string {
  const body = parseDraft(draft).map(lineHtml).filter(Boolean).join("\n");

  return `<!doctype html>
<html lang="ar" dir="rtl">
<head>
<meta charset="utf-8" />
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body { direction: rtl; }
  body {
    /* No @font-face indirection: local() family matching inside @font-face is
       unreliable in headless Chromium and silently falls back to a font with
       no Arabic glyphs. A plain font-family stack uses the browser's normal
       (reliable) family lookup instead. */
    font-family: "Noto Naskh Arabic", "Segoe UI", Tahoma, Arial, sans-serif;
    font-size: 13pt;
    line-height: 2;
    color: #111;
  }
  .header { text-align: center; font-size: 16pt; font-weight: 700; margin-bottom: 10pt; }
  .heading {
    font-size: 13.5pt;
    font-weight: 700;
    margin-top: 16pt;
    margin-bottom: 8pt;
    padding-bottom: 3pt;
    border-bottom: 1pt solid #999;
  }
  .signature { font-size: 13pt; font-weight: 600; margin-top: 28pt; text-align: right; }
  .body { margin-bottom: 6pt; white-space: pre-wrap; }
  .cite { font-size: 9pt; }
</style>
</head>
<body>
${body}
</body>
</html>`;
}

export async function draftToPdf(draft: string): Promise<Buffer> {
  const browser = await getBrowser();
  const page = await browser.newPage();
  try {
    await page.setContent(draftHtml(draft), { waitUntil: "load" });
    const pdf = await page.pdf({
      format: "a4",
      margin: { top: "1in", bottom: "1in", left: "1in", right: "1in" },
      printBackground: true,
      displayHeaderFooter: true,
      // Must be set explicitly: leaving it out while displayHeaderFooter is
      // true makes Chromium show ITS OWN default header (page URL/title),
      // not nothing. Header/footer templates only support inline styles —
      // no <link>/<style> block — hence the style= attribute below instead
      // of reusing draftHtml()'s stylesheet.
      headerTemplate: "<span></span>",
      footerTemplate: `
        <div dir="rtl" style="width:100%; font-size:9px; text-align:center; color:#666; font-family:'Segoe UI',Tahoma,Arial,sans-serif;">
          صفحة <span class="pageNumber"></span> من <span class="totalPages"></span>
        </div>`,
    });
    return Buffer.from(pdf);
  } finally {
    await page.close();
  }
}
