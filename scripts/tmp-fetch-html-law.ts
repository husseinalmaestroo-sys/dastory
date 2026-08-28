/**
 * Fetches a law published as HTML and stages it to .txt via the project's own
 * html.ts path. HTML is the best source we have for a statute — real Unicode,
 * correct digits, no font map to corrupt and no OCR error — so where a law
 * exists as a web page it beats every PDF route.
 *
 * With no --selector, prints the candidate containers and their text size so
 * the selector can be chosen by looking rather than guessed (html.ts refuses
 * to guess, deliberately: on an ASP.NET page a broad selector silently mixes
 * nav furniture into a legal citation).
 *
 *   npx tsx --tsconfig scripts/tsconfig.verify.json scripts/tmp-fetch-html-law.ts <url> [out.txt] [selector]
 */
import { writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import * as cheerio from "cheerio";
import { extractHtmlText, extractHtmlTitle } from "../src/lib/ingest/html";
import { repairArticleHeaders } from "./tmp-header-repair";

async function main() {
  const [url, output, selector] = process.argv.slice(2);

  const res = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; ai-legal-ingest/1.0)" },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
  const html = await res.text();

  console.log(`fetched ${html.length} bytes — title: ${extractHtmlTitle(html) ?? "(none)"}`);

  if (!selector) {
    const $ = cheerio.load(html);
    $("script, style, noscript").remove();
    const seen = new Set<string>();
    const rows: { sel: string; chars: number; articles: number }[] = [];

    $("body, div, form, table, td, span").each((_, el) => {
      const $el = $(el);
      const id = $el.attr("id");
      const cls = ($el.attr("class") ?? "").split(/\s+/).filter(Boolean)[0];
      const sel = id ? `#${id}` : cls ? `${el.tagName}.${cls}` : el.tagName;
      if (seen.has(sel)) return;
      seen.add(sel);
      const text = $el.text();
      const articles = new Set([...text.matchAll(/المادة\s*\(?\s*(\d{1,3})/g)].map((m) => m[1])).size;
      if (text.length > 2000) rows.push({ sel, chars: text.length, articles });
    });

    rows.sort((a, b) => b.articles - a.articles || a.chars - b.chars);
    console.log(`\ncandidate containers (most articles, then smallest):`);
    for (const r of rows.slice(0, 12)) {
      console.log(`  ${r.sel.padEnd(34)} chars=${String(r.chars).padStart(7)}  articles=${r.articles}`);
    }
    console.log(`\nRe-run with a selector to stage the text.`);
    return;
  }

  const raw = extractHtmlText(html, selector);
  const { text, fixed } = repairArticleHeaders(raw);

  const arts = new Set([...text.matchAll(/المادة\s*\(?\s*(\d{1,3})/g)].map((m) => Number(m[1])));
  const max = arts.size ? Math.max(...arts) : 0;
  const missing = Array.from({ length: max }, (_, i) => i + 1).filter((i) => !arts.has(i));

  if (output) {
    await mkdir(dirname(output), { recursive: true });
    await writeFile(output, text, "utf8");
  }
  console.log(
    `\n  ${text.length} chars, ${arts.size} articles (max ${max}), ${fixed} headers repaired -> ${output ?? "(not written)"}`
  );
  if (missing.length) {
    console.log(`  missing: ${missing.slice(0, 30).join(",")}${missing.length > 30 ? ` … (${missing.length})` : ""}`);
  }
}

main().catch((e) => {
  console.error(`failed: ${e.message}`);
  process.exit(1);
});
