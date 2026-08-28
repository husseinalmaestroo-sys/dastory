/**
 * Parses the marker format the drafting prompt emits (see FORMAT_RULES in
 * ai/prompts.ts) into typed lines.
 *
 * Both the on-screen paper and the .docx export read from this, so the printed
 * page and the downloaded file cannot drift apart in structure — the only
 * difference between them should be the medium.
 */

export type DocLineType = "header" | "heading" | "signature" | "body" | "blank";

export interface DocLine {
  type: DocLineType;
  text: string;
}

export function parseDraft(draft: string): DocLine[] {
  return draft
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((raw): DocLine => {
      const line = raw.trimEnd();
      if (line.trim() === "") return { type: "blank", text: "" };
      if (line.startsWith("### ")) return { type: "signature", text: line.slice(4).trim() };
      if (line.startsWith("## ")) return { type: "heading", text: line.slice(3).trim() };
      if (line.startsWith("# ")) return { type: "header", text: line.slice(2).trim() };
      return { type: "body", text: line.trim() };
    });
}

/**
 * The document as plain text — markers stripped, structure kept via blank
 * lines. This is what the clipboard and the .txt download get, so pasting into
 * Word by hand still yields something a court would accept.
 */
export function draftToPlainText(draft: string): string {
  return parseDraft(draft)
    .map((l) => (l.type === "blank" ? "" : l.text))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Segments a line into text runs and [1]-style citation refs. */
export function splitCitations(text: string): { text: string; cite?: number }[] {
  const out: { text: string; cite?: number }[] = [];
  const re = /\[(\d{1,2})\]/g;
  let last = 0;
  let m: RegExpExecArray | null;

  while ((m = re.exec(text))) {
    if (m.index > last) out.push({ text: text.slice(last, m.index) });
    out.push({ text: m[1], cite: Number(m[1]) });
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push({ text: text.slice(last) });

  return out;
}

/** True for the [يُستكمل: ...] placeholders the model leaves for the lawyer. */
export const TODO_RE = /\[يُستكمل:[^\]]*\]/g;

export function countTodos(draft: string): number {
  return draft.match(TODO_RE)?.length ?? 0;
}

/**
 * Groups parsed lines into editable blocks: header/heading/signature stay one
 * line each, consecutive body (and interior blank) lines merge into a single
 * multi-line block. This is what makes the on-screen paper editable without
 * turning the whole document into one shapeless textarea — a lawyer edits the
 * paragraph under "الوقائع", not raw marker syntax.
 */
export interface DraftBlock {
  id: string;
  type: DocLineType;
  text: string;
}

export function draftToBlocks(draft: string): DraftBlock[] {
  const lines = parseDraft(draft);
  const blocks: DraftBlock[] = [];
  let n = 0;

  for (const line of lines) {
    const prev = blocks[blocks.length - 1];
    if (line.type === "body" || (line.type === "blank" && prev?.type === "body")) {
      if (prev?.type === "body") {
        prev.text += "\n" + line.text;
      } else {
        blocks.push({ id: `b${n++}`, type: "body", text: line.text });
      }
    } else if (line.type !== "blank") {
      blocks.push({ id: `b${n++}`, type: line.type, text: line.text });
    }
  }

  // Trailing blank lines inside a merged body block read oddly in a textarea.
  for (const b of blocks) b.text = b.text.replace(/\n+$/, "");

  return blocks;
}

export function blocksToDraft(blocks: DraftBlock[]): string {
  const marker: Record<DocLineType, string> = { header: "# ", heading: "## ", signature: "### ", body: "", blank: "" };

  return blocks
    .map((b) => {
      if (b.type === "body") return b.text;
      return marker[b.type] + b.text;
    })
    .join("\n\n")
    .trim();
}

/** The nearest preceding "## " heading's text for a block — lets the refine
 *  UI tell the model which section a body block belongs to without threading
 *  a label through separately. "" for a body block before any heading (the
 *  case-number/case-value front matter some skeletons put under the header). */
export function sectionHeadingFor(blocks: DraftBlock[], blockId: string): string {
  const idx = blocks.findIndex((b) => b.id === blockId);
  for (let i = idx - 1; i >= 0; i--) {
    if (blocks[i].type === "heading") return blocks[i].text;
  }
  return "";
}

const SECTION_BOUNDARY = new Set<DocLineType>(["heading", "header", "signature"]);

/** Every top-level section's [start, end) index range, in document order — a
 *  section is a heading plus every block up to the next heading/header/
 *  signature. The fixed header (top) and signature (bottom) blocks are never
 *  part of any range, which is what keeps moveSection from ever crossing
 *  them. */
function sectionRanges(blocks: DraftBlock[]): [number, number][] {
  const ranges: [number, number][] = [];
  for (let i = 0; i < blocks.length; i++) {
    if (blocks[i].type !== "heading") continue;
    let end = i + 1;
    while (end < blocks.length && !SECTION_BOUNDARY.has(blocks[end].type)) end++;
    ranges.push([i, end]);
  }
  return ranges;
}

/**
 * Moves a whole section (its heading plus every body block under it) past
 * the adjacent section — a pure client-side reorder, no LLM call, since
 * reordering doesn't change any content. No-ops at either edge (moving the
 * first section up, or the last section down) rather than crossing into the
 * pinned header/signature blocks.
 */
export function moveSection(
  blocks: DraftBlock[],
  headingBlockId: string,
  direction: "up" | "down"
): DraftBlock[] {
  const ranges = sectionRanges(blocks);
  const idx = ranges.findIndex(([start]) => blocks[start].id === headingBlockId);
  if (idx === -1) return blocks;

  const otherIdx = direction === "up" ? idx - 1 : idx + 1;
  if (otherIdx < 0 || otherIdx >= ranges.length) return blocks;

  const [firstStart, firstEnd] = direction === "up" ? ranges[otherIdx] : ranges[idx];
  const [secondStart, secondEnd] = direction === "up" ? ranges[idx] : ranges[otherIdx];
  if (firstEnd !== secondStart) return blocks; // not actually adjacent — leave untouched

  return [
    ...blocks.slice(0, firstStart),
    ...blocks.slice(secondStart, secondEnd),
    ...blocks.slice(firstStart, firstEnd),
    ...blocks.slice(secondEnd),
  ];
}
