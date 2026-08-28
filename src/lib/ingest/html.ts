import "server-only";
import * as cheerio from "cheerio";

/**
 * Extracts document text from an HTML page.
 *
 * Some of the best legal sources are HTML, not PDF — the Judicial Council
 * publishes the Special Bureau's binding interpretations as web pages. That
 * text is strictly better than any PDF we have: real Unicode, correct digits,
 * no broken font map, no OCR. It is worth a dedicated path.
 *
 * A CSS selector is required rather than guessed. Readability-style heuristics
 * exist, but on an ASP.NET site whose every page carries the same 14KB of nav,
 * accessibility widgets and footer, a wrong guess silently mixes site
 * furniture into a legal citation. The operator looks at the page once and
 * names the container; the tool stays generic.
 */
export function extractHtmlText(html: string, selector: string): string {
  const $ = cheerio.load(html);

  // Strip non-content first so it cannot leak in even if the selector is broad.
  $("script, style, noscript, svg, nav, header, footer, iframe, form.search").remove();

  const root = $(selector);
  if (root.length === 0) {
    throw new Error(`Selector "${selector}" matched nothing on this page.`);
  }

  // <br> and block ends carry the paragraph structure the chunker relies on;
  // cheerio's .text() would concatenate straight through them.
  root.find("br").replaceWith("\n");
  root.find("p, div, li, tr, h1, h2, h3, h4, h5, h6").each((_, el) => {
    $(el).append("\n");
  });

  return root
    .text()
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t ]+/g, " ")
    .split("\n")
    .map((l) => l.trim())
    .filter((l, i, arr) => l.length > 0 || (i > 0 && arr[i - 1].length > 0)) // collapse blank runs
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Page <title>, minus the site-name suffix, as a fallback source title. */
export function extractHtmlTitle(html: string): string | null {
  const $ = cheerio.load(html);
  const t = $("title").first().text().trim();
  if (!t) return null;
  return t.split(/\s+[-|–]\s+/)[0].trim() || null;
}
