/**
 * Politely downloads PDFs linked from plain-HTML pages, into a local folder
 * that `npm run ingest` can then index.
 *
 *   npm run fetch -- <listing-url> [more urls...] --out=./downloads/moj [options]
 *   npm run fetch -- --list=urls.txt --out=./downloads/moj
 *
 * A URL may be a listing page (its PDF links are extracted) or a direct .pdf
 * (downloaded as-is). Mixed input is fine.
 *
 * Options:
 *   --list=<file>      Read URLs from a file, one per line (# comments ok).
 *                      For lists gathered by hand from JS-paginated sites.
 *   --out=<dir>        Destination folder. Default: ./downloads
 *   --delay=<ms>       Pause between requests. Default: 1500. Do not lower it
 *                      without a reason — see "Politeness" below.
 *   --match=<regex>    Only keep PDF links whose URL matches. Needed when a
 *                      listing page also links site furniture (a strategy
 *                      plan, a services guide) alongside the real documents —
 *                      e.g. --match=news_new
 *   --max=<n>          Stop after n downloads.
 *   --dry-run          List what would be downloaded. Fetches listing pages
 *                      only; downloads nothing.
 *   --same-host        Only follow PDF links on the listing's own host (default
 *                      on). --no-same-host to allow others.
 *   --ignore-robots    Refuse to honour robots.txt. Requires you to have a
 *                      right to the content that overrides it. Logged loudly.
 *
 * Example — Ministry of Justice laws listing:
 *   npm run fetch -- "https://moj.gov.jo/EN/List/Laws" --out=./downloads/moj --dry-run
 *   npm run ingest -- ./downloads/moj --type=law
 *
 * ── Scope, deliberately ──────────────────────────────────────────────
 * This handles plain server-rendered HTML with direct <a href="...pdf"> links.
 * It does NOT drive JavaScript apps, solve ASP.NET postback pagination, or
 * work around an encrypted API or a WAF. If a site needs any of that, the site
 * is telling you it does not want scripted access — get the files through the
 * front door, or ask its operator for a bulk feed. lob.gov.jo is exactly such
 * a site: its API payloads are AES-encrypted client-side and it sits behind a
 * WAF. Use it by hand and point `npm run ingest` at your downloads folder.
 *
 * ── Politeness ───────────────────────────────────────────────────────
 * robots.txt is honoured. Requests are serialised with a delay — one at a
 * time, never in parallel. The User-Agent says what this is. These are not
 * decoration: a government file server is not a CDN, and a burst of parallel
 * requests from one IP is indistinguishable from an attack. Your VPS has one
 * IP; getting it blocked takes your whole site down with it.
 */
import "dotenv/config";
import { mkdir, writeFile, stat, readFile } from "node:fs/promises";
import { fileNameFrom } from "../src/lib/ingest/source-files";
import { join, resolve } from "node:path";
// Phase 2.4: downloads go through the environment's HTTPS proxy when one is set, never around it.
import { proxiedFetch } from "../src/lib/net/proxy";

const UA = "ai-legal-assistant/0.1 (legal research corpus builder; contact: site admin)";

type Opts = {
  urls: string[];
  out: string;
  delay: number;
  max: number | null;
  match: RegExp | null;
  asText: string | null;
  dryRun: boolean;
  sameHost: boolean;
  ignoreRobots: boolean;
};

async function parseArgs(): Promise<Opts> {
  const args = process.argv.slice(2);
  const get = (k: string) => args.find((a) => a.startsWith(`--${k}=`))?.split("=").slice(1).join("=") ?? null;

  const urls = args.filter((a) => !a.startsWith("--"));

  const listFile = get("list");
  if (listFile) {
    const text = await readFile(resolve(listFile), "utf8");
    urls.push(
      ...text
        .split("\n")
        .map((l) => l.trim())
        .filter((l) => l && !l.startsWith("#"))
    );
  }

  if (urls.length === 0) {
    console.error("Usage: fetch-sources.ts <url> [...] --out=./downloads/moj [--dry-run]");
    console.error("   or: fetch-sources.ts --list=urls.txt --out=./downloads/moj");
    process.exit(1);
  }

  const matchRaw = get("match");
  let match: RegExp | null = null;
  if (matchRaw) {
    try {
      match = new RegExp(matchRaw, "i");
    } catch (err) {
      console.error(`--match is not a valid regex: ${(err as Error).message}`);
      process.exit(1);
    }
  }

  return {
    urls,
    out: resolve(get("out") ?? "./downloads"),
    delay: Number(get("delay") ?? 1500),
    max: get("max") ? Number(get("max")) : null,
    match,
    asText: get("as-text"),
    dryRun: args.includes("--dry-run"),
    sameHost: !args.includes("--no-same-host"),
    ignoreRobots: args.includes("--ignore-robots"),
  };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------- robots

/**
 * Minimal robots.txt: collects Disallow rules for `*` and our UA.
 *
 * Not a full spec implementation — it does not do Allow-overrides-Disallow
 * precedence. It errs toward *not* fetching, which is the safe direction to be
 * wrong in. A 404 (no robots.txt) means no restrictions.
 */
async function loadDisallows(origin: string): Promise<string[]> {
  try {
    const res = await proxiedFetch(`${origin}/robots.txt`, { headers: { "User-Agent": UA } });
    if (!res.ok) return [];
    const text = await res.text();

    const rules: string[] = [];
    let applies = false;
    for (const raw of text.split("\n")) {
      const line = raw.split("#")[0].trim();
      if (!line) continue;
      const [k, ...rest] = line.split(":");
      const key = k.trim().toLowerCase();
      const val = rest.join(":").trim();

      if (key === "user-agent") applies = val === "*" || UA.toLowerCase().includes(val.toLowerCase());
      else if (key === "disallow" && applies && val) rules.push(val);
    }
    return rules;
  } catch {
    return [];
  }
}

function blocked(url: string, disallows: string[]): boolean {
  const path = new URL(url).pathname;
  return disallows.some((d) => (d === "/" ? true : path.startsWith(d)));
}

// ---------------------------------------------------------------- extract

/**
 * Pulls PDF hrefs out of raw HTML.
 *
 * A regex, not a DOM parse: we need href values, not structure, and adding a
 * parser dependency for one attribute is not worth it. Handles single, double
 * and unquoted attribute forms.
 */
function extractPdfLinks(html: string, base: string, sameHost: boolean): string[] {
  const out = new Set<string>();
  const baseHost = new URL(base).host;

  for (const m of html.matchAll(/href\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s>]+))/gi)) {
    const raw = (m[1] ?? m[2] ?? m[3] ?? "").trim();
    if (!raw || raw.startsWith("#") || raw.startsWith("javascript:") || raw.startsWith("mailto:")) continue;

    let abs: URL;
    try {
      abs = new URL(raw, base);
    } catch {
      continue;
    }
    if (abs.protocol !== "https:" && abs.protocol !== "http:") continue;
    // Query strings can carry the extension (?file=x.pdf), so test the whole URL.
    if (!/\.pdf(?:$|[?#])/i.test(abs.href)) continue;
    if (sameHost && abs.host !== baseHost) continue;

    abs.hash = "";
    out.add(abs.href);
  }
  return [...out];
}

// ---------------------------------------------------------------- main

async function main() {
  const opts = await parseArgs();

  // --as-text: the pages ARE the documents, not indexes of them. Used for
  // sources published as HTML rather than files — the Judicial Council's
  // binding interpretations, for one, whose web text is cleaner than any PDF
  // on offer (correct digits, no font-map damage, no OCR).
  if (opts.asText) return fetchAsText(opts, opts.asText);

  // A direct .pdf needs no listing fetch — it *is* the target. Splitting here
  // keeps a hand-gathered URL list (from a JS-paginated site a scraper cannot
  // read) on the same code path as an automatic listing scan.
  const direct = opts.urls.filter((u) => /\.pdf(?:$|[?#])/i.test(u));
  const listings = opts.urls.filter((u) => !/\.pdf(?:$|[?#])/i.test(u));

  console.log(`\nListing pages : ${listings.length}`);
  console.log(`Direct PDFs   : ${direct.length}`);
  console.log(`Destination   : ${opts.out}`);
  console.log(`Delay         : ${opts.delay}ms between requests\n`);

  const robotsByOrigin = new Map<string, string[]>();
  const found = new Map<string, string>(); // url -> where it came from

  for (const u of direct) found.set(u, "(direct)");

  for (const listing of listings) {
    let origin: string;
    try {
      origin = new URL(listing).origin;
    } catch {
      console.error(`  ! not a valid URL, skipping: ${listing}`);
      continue;
    }

    if (!robotsByOrigin.has(origin)) {
      robotsByOrigin.set(origin, opts.ignoreRobots ? [] : await loadDisallows(origin));
      const n = robotsByOrigin.get(origin)!.length;
      console.log(`  robots.txt @ ${origin}: ${n} disallow rule(s)${opts.ignoreRobots ? " (IGNORED — you asked)" : ""}`);
      await sleep(opts.delay);
    }
    const disallows = robotsByOrigin.get(origin)!;

    if (blocked(listing, disallows)) {
      console.error(`  ! robots.txt disallows ${listing} — skipping.`);
      continue;
    }

    process.stdout.write(`  fetching ${listing} ... `);
    let html: string;
    try {
      const res = await proxiedFetch(listing, { headers: { "User-Agent": UA, Accept: "text/html" } });
      if (!res.ok) {
        console.log(`HTTP ${res.status}`);
        // 403 from a WAF looks identical to a real block. Say so, because the
        // fix is not "retry harder".
        if (res.status === 403 || res.status === 401) {
          console.log(`      (this site is refusing scripted access — download by hand instead)`);
        }
        continue;
      }
      html = await res.text();
    } catch (err) {
      console.log(`failed: ${(err as Error).message}`);
      continue;
    }

    const links = extractPdfLinks(html, listing, opts.sameHost)
      .filter((l) => !blocked(l, disallows))
      .filter((l) => !opts.match || opts.match.test(l));
    console.log(`${links.length} PDF link(s)`);
    for (const l of links) if (!found.has(l)) found.set(l, listing);

    await sleep(opts.delay);
  }

  console.log(`\n${"=".repeat(58)}`);
  console.log(`  unique PDFs found : ${found.size}`);
  console.log(`${"=".repeat(58)}\n`);

  if (found.size === 0) {
    console.log("Nothing to download.");
    console.log("If you expected links here, the page is probably a JavaScript app that");
    console.log("renders its list client-side. This tool only reads plain HTML — open the");
    console.log("page in a browser and download what you need, then run: npm run ingest\n");
    return;
  }

  if (opts.dryRun) {
    console.log("Dry run — nothing downloaded:\n");
    for (const url of [...found.keys()].slice(0, 30)) console.log(`  ${fileNameFrom(url)}\n      ${url}`);
    if (found.size > 30) console.log(`  ... and ${found.size - 30} more`);
    console.log("");
    return;
  }

  await mkdir(opts.out, { recursive: true });

  let ok = 0;
  let skipped = 0;
  let failed = 0;

  for (const [i, url] of [...found.keys()].entries()) {
    if (opts.max && ok >= opts.max) {
      console.log(`\nReached --max=${opts.max}, stopping.`);
      break;
    }

    const name = fileNameFrom(url);
    const dest = join(opts.out, name);
    const label = `[${i + 1}/${found.size}] ${name.slice(0, 50)}`;

    // Resumable: an interrupted run re-runs cheaply instead of re-fetching
    // everything already on disk.
    if (await stat(dest).then((s) => s.size > 0).catch(() => false)) {
      console.log(`${label.padEnd(66)} skip (exists)`);
      skipped++;
      continue;
    }

    process.stdout.write(`${label.padEnd(66)}`);
    try {
      const res = await proxiedFetch(url, { headers: { "User-Agent": UA } });
      if (!res.ok) {
        console.log(`HTTP ${res.status}`);
        failed++;
        await sleep(opts.delay);
        continue;
      }

      const buf = Buffer.from(await res.arrayBuffer());

      // A "PDF" link that returns an HTML error or login page is common; catch
      // it here rather than letting ingest fail on it 300 files later.
      if (buf.subarray(0, 5).toString("latin1") !== "%PDF-") {
        console.log(`not a PDF (got ${res.headers.get("content-type") ?? "?"})`);
        failed++;
        await sleep(opts.delay);
        continue;
      }

      await writeFile(dest, buf);
      console.log(`ok  ${(buf.length / 1024).toFixed(0)}KB`);
      ok++;
    } catch (err) {
      console.log(`failed: ${(err as Error).message}`);
      failed++;
    }

    await sleep(opts.delay);
  }

  console.log(`\n${"=".repeat(58)}`);
  console.log(`  ${ok} downloaded, ${skipped} already present, ${failed} failed`);
  console.log(`${"=".repeat(58)}`);
  console.log(`\nNext:\n  npm run ingest -- "${opts.out}" --dry-run\n`);
}

/**
 * Saves each URL's content as a .txt file that `npm run ingest` reads directly.
 * `selector` names the element holding the document — see src/lib/ingest/html.ts
 * for why it is required rather than guessed.
 */
async function fetchAsText(opts: Opts, selector: string) {
  const { extractHtmlText, extractHtmlTitle } = await import("../src/lib/ingest/html");

  console.log(`\nPages     : ${opts.urls.length}`);
  console.log(`Selector  : ${selector}`);
  console.log(`Dest      : ${opts.out}`);
  console.log(`Delay     : ${opts.delay}ms\n`);

  if (!opts.dryRun) await mkdir(opts.out, { recursive: true });

  let ok = 0;
  let skipped = 0;
  let failed = 0;

  for (const [i, url] of opts.urls.entries()) {
    if (opts.max && ok >= opts.max) {
      console.log(`\nReached --max=${opts.max}, stopping.`);
      break;
    }

    // Last path segment as the filename, so ".../2199/45" becomes "45.txt".
    const id = new URL(url).pathname.split("/").filter(Boolean).pop() ?? String(i);
    const dest = join(opts.out, `${id}.txt`);
    const label = `[${i + 1}/${opts.urls.length}] ${id}`;

    if (!opts.dryRun && (await stat(dest).then((s) => s.size > 0).catch(() => false))) {
      console.log(`${label.padEnd(26)} skip (exists)`);
      skipped++;
      continue;
    }

    process.stdout.write(`${label.padEnd(26)}`);
    try {
      const res = await proxiedFetch(url, { headers: { "User-Agent": UA, Accept: "text/html" } });
      if (!res.ok) {
        console.log(`HTTP ${res.status}`);
        failed++;
        await sleep(opts.delay);
        continue;
      }

      const html = await res.text();
      const title = extractHtmlTitle(html);
      const body = extractHtmlText(html, selector);

      if (body.length < 200) {
        // Almost certainly the selector matching a shell rather than content.
        console.log(`too short (${body.length} chars) — check --as-text selector`);
        failed++;
        await sleep(opts.delay);
        continue;
      }

      // The title goes in the file because a .txt carries no metadata, and the
      // ingest pipeline reads the law/decision name out of the text head.
      const out = title ? `${title}\n\n${body}` : body;

      if (opts.dryRun) {
        console.log(`ok  ${out.length} chars  ${JSON.stringify(body.slice(0, 40))}`);
      } else {
        await writeFile(dest, out, "utf8");
        console.log(`ok  ${out.length} chars`);
      }
      ok++;
    } catch (err) {
      console.log(`failed: ${(err as Error).message}`);
      failed++;
    }

    await sleep(opts.delay);
  }

  console.log(`\n${"=".repeat(58)}`);
  console.log(`  ${ok} saved, ${skipped} already present, ${failed} failed`);
  console.log(`${"=".repeat(58)}`);
  if (!opts.dryRun) console.log(`\nNext:\n  npm run ingest -- "${opts.out}" --dry-run\n`);
}

main().catch((err) => {
  console.error("\nFetch failed:", err.message);
  process.exit(1);
});
