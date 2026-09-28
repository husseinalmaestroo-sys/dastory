import { extname } from "node:path";

/**
 * The file name a downloaded source is stored under: the URL's last path
 * segment, percent-decoded, made safe as a filename. Shared by the fetcher
 * (scripts/fetch-sources.ts), which names the files, and the provenance
 * backfill (corpus/provenance.ts), which finds a stored file's URL again.
 */
export function fileNameFrom(url: string): string {
  const seg = decodeURIComponent(new URL(url).pathname.split("/").pop() ?? "file.pdf");
  const safe = seg
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, "_") // illegal on Windows / path traversal
    .replace(/\s+/g, "_")
    .slice(0, 150);
  return extname(safe).toLowerCase() === ".pdf" ? safe : `${safe}.pdf`;
}
