import "server-only";
import { createHash } from "node:crypto";
import { env } from "../env";
import { foldForSearch, normalizeDigits } from "../ingest/clean";
import { stemArabicWord } from "../search/arabic-stem";
import type { ChatMessage, ChatOptions, ChatProvider, ChatResult, EmbeddingProvider, EmbedResult } from "./provider";

/**
 * DETERMINISTIC OFFLINE TEST PROVIDERS — never a real model.
 *
 * Phase 2 needs the whole pipeline (auth → retrieval → prompt → generation →
 * grounding → validation → accounting) to run in CI and in the evaluation
 * harness without network access or API keys. These two providers stand in
 * for the vendor APIs:
 *
 *   test-hash-embed-v1   — a feature-hashing embedder over light-stemmed
 *                          words and character trigrams. Lexical, not
 *                          semantic: retrieval metrics measured with it say
 *                          how the fusion/filters/scoping logic behaves, NOT
 *                          how well a real embedding model retrieves Arabic
 *                          law. Reports are labelled accordingly.
 *   test-extractive-v1   — an extractive "model" that reads the fenced prompt
 *                          (untrusted.ts), picks the source block that best
 *                          overlaps the question, and answers by quoting it.
 *                          It follows instructions perfectly and never
 *                          invents anything, so it can only test the
 *                          pipeline's plumbing — never the model's legal
 *                          reasoning, false-premise handling or injection
 *                          resistance (those are live-evaluation items).
 *
 * Adversarial model OUTPUTS (fabricated citations, leaked prompts…) are not
 * produced here; tests feed such strings directly to the validators.
 *
 * Guard: selectable only outside production, or with ALLOW_TEST_PROVIDERS=true.
 */

export const TEST_CHAT_MODEL = "test-extractive-v1";
export const TEST_EMBED_MODEL = "test-hash-embed-v1";

export function testProvidersAllowed(): boolean {
  return process.env.NODE_ENV !== "production" || process.env.ALLOW_TEST_PROVIDERS === "true";
}

/** Test hook: every message list the test chat model receives (security tests assert on prompts). */
export const testProviderHooks: { onChat: ((messages: ChatMessage[], opts: ChatOptions) => void) | null } = { onChat: null };

// ------------------------------------------------------------------ embeddings

const STOP = new Set(
  [
    "في", "من", "على", "الى", "إلى", "عن", "ان", "أن", "إن", "او", "أو", "ما", "ماذا", "هل", "كيف", "متى", "هو", "هي",
    "التي", "الذي", "الذين", "هذا", "هذه", "ذلك", "تلك", "كل", "اي", "أي", "مع", "بين", "قد", "لا", "لم", "لن", "ثم",
    "و", "كان", "كانت", "يكون", "تكون", "به", "بها", "له", "لها", "فيه", "فيها", "عليه", "عليها", "منه", "منها", "حسب",
    "the", "a", "an", "of", "to", "in", "and", "or", "is", "are", "what", "which", "for", "on", "by", "with",
  ].map((w) => foldForSearch(w))
);

function contentWords(text: string): string[] {
  const words = foldForSearch(normalizeDigits(text))
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w.length > 1 && !STOP.has(w));
  return words.map((w) => (/^\p{N}+$/u.test(w) ? w : stemArabicWord(w) || w));
}

function fnv1a(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export function hashEmbed(text: string, dim: number): number[] {
  const v = new Float64Array(dim);
  const add = (feature: string, weight: number) => {
    const h = fnv1a(feature);
    v[h % dim] += (h & 0x80000000 ? -1 : 1) * weight;
  };
  for (const w of contentWords(text)) {
    add(`w:${w}`, 1);
    const padded = `^${w}$`;
    for (let i = 0; i + 3 <= padded.length; i++) add(`t:${padded.slice(i, i + 3)}`, 0.35);
  }
  let norm = 0;
  for (let i = 0; i < dim; i++) norm += v[i] * v[i];
  norm = Math.sqrt(norm) || 1;
  return Array.from(v, (x) => x / norm);
}

export const testEmbeddingProvider: EmbeddingProvider = {
  name: "test",
  model: TEST_EMBED_MODEL,
  get dimensions() {
    return env.embeddingDim;
  },
  async embed(texts: string[]): Promise<EmbedResult> {
    return {
      embeddings: texts.map((t) => hashEmbed(t, env.embeddingDim)),
      // A stand-in token count (words), so accounting paths are exercised with non-zero numbers.
      tokens: texts.reduce((n, t) => n + contentWords(t).length, 0),
    };
  },
};

// ------------------------------------------------------------------ prompt parsing

type Block = { kind: string; label: string; content: string };

/** Reads the nonce-fenced blocks untrusted.ts writes. */
export function parseFencedBlocks(text: string): Block[] {
  const out: Block[] = [];
  const re = /<<<(SOURCE|DOCUMENT|QUESTION|HISTORY) ([^#\n]*?) #([0-9a-f]+)>>>\n([\s\S]*?)\n<<<END \1 \2 #\3>>>/g;
  for (const m of text.matchAll(re)) out.push({ kind: m[1], label: m[2].trim(), content: m[4] });
  return out;
}

type ParsedSource = { n: number; title: string; law: string | null; article: string | null; historical: boolean; text: string };

function parseSource(b: Block): ParsedSource {
  const lines = b.content.split("\n");
  const title = (lines.find((l) => l.startsWith("العنوان: ")) ?? "").slice("العنوان: ".length).trim();
  const metaLine = lines.find((l) => l.startsWith("القانون: ") || l.includes(" | المادة: ") || l.startsWith("المادة: ")) ?? "";
  const law = metaLine.match(/القانون: ([^|]+)/)?.[1]?.trim() ?? null;
  const article = metaLine.match(/المادة: ([^|]+)/)?.[1]?.trim() ?? null;
  const status = lines.find((l) => l.startsWith("حالة النص: ")) ?? "";
  const at = lines.findIndex((l) => l === "النص:");
  const text = at >= 0 ? lines.slice(at + 1).join("\n").replace(/━━━ نهاية المصدر[^\n]*$/, "").trim() : b.content;
  return { n: Number(b.label) || 0, title, law, article, historical: status.includes("نص سابق"), text };
}

function sentences(text: string): string[] {
  return text
    .split(/(?<=[.؛!؟?])\s+|\n+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function overlap(a: string[], b: Set<string>): number {
  let n = 0;
  for (const w of new Set(a)) if (b.has(w)) n++;
  return n;
}

// ------------------------------------------------------------------ task handlers

const NO_BASIS = "لم أجد سنداً قانونياً كافياً ضمن قاعدة البيانات القانونية المتاحة.";

function answerFromSources(question: string, sources: ParsedSource[]): string {
  const qWords = contentWords(question);
  const qArticles = [...normalizeDigits(question).matchAll(/ماد[ةه]\s*\(?\s*(\d{1,4})/g)].map((m) => m[1]);
  const scored = sources
    .map((s) => {
      const sWords = new Set(contentWords(`${s.title} ${s.law ?? ""} ${s.text}`));
      const articleHit = s.article && qArticles.includes(normalizeDigits(s.article)) ? 3 : 0;
      return { s, score: overlap(qWords, sWords) + articleHit };
    })
    .sort((a, b) => b.score - a.score || a.s.n - b.s.n);

  const best = scored[0];
  if (!best || best.score < 2) return NO_BASIS;

  const src = best.s;
  const qSet = new Set(qWords);
  const bestSentence =
    sentences(src.text)
      .map((t) => ({ t, score: overlap(contentWords(t), qSet) }))
      .sort((a, b) => b.score - a.score)[0]?.t ?? src.text.slice(0, 200);
  const quote = bestSentence.replace(/["“”«»]/g, "").trim();
  const identity = [src.article ? `المادة ${src.article}` : null, src.law ?? src.title].filter(Boolean).join(" من ");

  const lines = [`الخلاصة: ${identity}: ${quote.split(/\s+/).slice(0, 14).join(" ")} [${src.n}].`, `النص القانوني: "${quote}" [${src.n}].`];
  if (src.historical) lines.push(`حدود الإجابة: هذا النص نص سابق غير نافذ حالياً [${src.n}].`);
  return lines.join("\n\n");
}

function caseAnalysisJson(doc: string, sources: ParsedSource[]): string {
  const parties: { role: string; name: string; excerpt: string }[] = [];
  for (const m of doc.matchAll(/(المدعى عليه|المدعي|المدعية|المشتكى عليه|المشتكي)\s*[:：]\s*([^\n،.]{2,60})/g)) {
    const role = m[1].startsWith("المدعى عليه") || m[1].startsWith("المشتكى عليه") ? "مدعى عليه" : "مدعي";
    parties.push({ role, name: m[2].trim(), excerpt: m[0].trim() });
  }
  const facts = sentences(doc)
    .filter((s) => s.split(/\s+/).length >= 5)
    .slice(0, 3)
    .map((s) => ({ fact: s, excerpt: s }));
  const cited = [...normalizeDigits(doc).matchAll(/المادة\s*\(?\d{1,4}\)?\s+من\s+[^\n.،]{3,50}/g)].map((m) => m[0].trim());
  return JSON.stringify({
    summary: sentences(doc)[0]?.slice(0, 300) ?? "",
    parties,
    facts,
    case_type: "أخرى",
    cited_articles: cited,
    legal_basis: sources.slice(0, 1).map((s) => ({ point: `${s.law ?? s.title}${s.article ? ` المادة ${s.article}` : ""}`, citation: `[${s.n}]` })),
    possible_defenses: [],
    strengths: [],
    weaknesses: [],
    gaps: sources.length ? [] : ["لا توجد مصادر مسترجعة لهذا الملف"],
  });
}

function contractReviewJson(doc: string): string {
  const parties: string[] = [];
  for (const m of doc.matchAll(/(?:الفريق|الطرف)\s+(?:الأول|الثاني|الاول)\s*[:：]\s*([^\n،.]{2,60})/g)) parties.push(m[1].trim());
  for (const m of doc.matchAll(/Party\s+(?:A|B|1|2|One|Two)\s*:\s*([^\n,.]{2,60})/gi)) parties.push(m[1].trim());
  const keyTerms = [...doc.matchAll(/^(?:البند|المادة|Clause)\s*[^:\n]{0,30}:\s*(.{3,160})$/gm)]
    .slice(0, 8)
    .map((m) => ({ label: m[0].split(":")[0].trim(), value: m[1].trim() }));
  const risks = sentences(doc)
    .filter((s) => /غرامة|شرط جزائي|فسخ|إنهاء|تعويض|penalt|terminat|indemn/i.test(s))
    .slice(0, 6)
    .map((s) => ({
      severity: "medium",
      title: "بند يستحق المراجعة",
      excerpt: s.slice(0, 200),
      explanation: "يتضمن هذا البند التزاماً أو جزاءً يستحق مراجعة صياغته وأثره.",
    }));
  return JSON.stringify({ summary: sentences(doc)[0]?.slice(0, 300) ?? "", parties, keyTerms, risks });
}

function draftDocument(system: string, fields: string, sources: ParsedSource[]): string {
  const title = system.match(/إعداد مسودة "([^"]+)"/)?.[1] ?? "مسودة";
  const basis = sources[0]
    ? `${sources[0].law ?? sources[0].title}${sources[0].article ? ` المادة ${sources[0].article}` : ""} [${sources[0].n}]`
    : "[يُستكمل: السند القانوني]";
  return [
    `# ${title}`,
    "## الوقائع",
    ...fields.split("\n").filter(Boolean),
    "## الأسانيد القانونية",
    basis,
    "## الطلبات",
    "[يُستكمل: الطلبات]",
    "### المحامي ..............",
  ].join("\n");
}

function respond(messages: ChatMessage[]): string {
  const system = messages.filter((m) => m.role === "system").map((m) => m.content).join("\n");
  const user = messages.filter((m) => m.role !== "system").map((m) => m.content).join("\n");
  const blocks = parseFencedBlocks(user);
  const sources = blocks.filter((b) => b.kind === "SOURCE").map(parseSource);
  const question = blocks.find((b) => b.kind === "QUESTION" && b.label === "1")?.content ?? "";
  const doc = (label: string) => blocks.find((b) => b.kind === "DOCUMENT" && b.label === label)?.content ?? "";

  if (system.includes("أداة إعادة صياغة")) return question;
  if (system.includes("مراجع جودة داخلي")) return JSON.stringify({ issues: [], notes: "مراجعة اختبارية" });
  if (system.includes("تحليل ملف قضية")) return caseAnalysisJson(doc("ملف القضية"), sources);
  if (system.includes("مراجعة نص عقد")) return contractReviewJson(doc("العقد"));
  if (system.includes("إعداد مسودة")) return draftDocument(system, doc("حقول المحامي"), sources);
  if (system.includes("تعديل قسم واحد")) return doc("القسم").replace(/^\(عنوان القسم: [^)]*\)\n/, "");
  if (system.includes("أنت مختص بالقانون الأردني") || system.includes("توجيه مفاهيمي عام") || system.includes("تحليلاً تكميلياً")) {
    return "هذه إجابة توجيهية عامة لا تستند إلى مصدر في قاعدة البيانات.";
  }
  if (sources.length > 0 && question) return answerFromSources(question, sources);
  // Classifier / expansion prompts and anything unrecognised: an unparseable
  // reply, which those callers treat as "no LLM help" (their documented fallback).
  return "";
}

function approxTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export const testChatProvider: ChatProvider = {
  name: "test",
  model: TEST_CHAT_MODEL,

  async chat(messages, opts = {}): Promise<ChatResult> {
    testProviderHooks.onChat?.(messages, opts);
    const text = respond(messages);
    return {
      text,
      tokensIn: messages.reduce((n, m) => n + approxTokens(m.content), 0),
      tokensOut: approxTokens(text),
      model: TEST_CHAT_MODEL,
    };
  },

  async *chatStream(messages, opts = {}) {
    const result = await testChatProvider.chat(messages, opts);
    for (const piece of result.text.match(/[\s\S]{1,40}/g) ?? []) yield piece;
    return result;
  },
};

/** Stable digest of a prompt (tests compare prompts without storing them). */
export function promptDigest(messages: ChatMessage[]): string {
  return createHash("sha256").update(JSON.stringify(messages)).digest("hex").slice(0, 16);
}
