/** Shared client/server shapes. No `server-only` import — this crosses the wire. */

export type Citation = {
  ref: number;
  id: number;
  title: string;
  sourceType?: string;
  articleNumber: string | null;
  lawName: string | null;
  court: string | null;
  decisionNumber: string | null;
  year: number | null;
  category?: string | null;
  excerpt: string;
  score?: number;
  matchedBy?: "vector" | "keyword" | "both";
};

/**
 * How an answer was produced. Drives how it is rendered — a lawyer must be
 * able to tell at a glance whether what they're reading is backed by a stored
 * source or is uncitable orientation.
 *
 *   grounded — built from retrieved sources; carries citations.
 *   general  — no source in the knowledge base; the model's general knowledge,
 *              with every article and decision number redacted server-side.
 *   refused  — no source, and the general fallback is disabled.
 */
export type AnswerMode = "grounded" | "general" | "refused";

export type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  sources?: Citation[];
  grounded?: boolean;
  mode?: AnswerMode;
  /**
   * Not-legal-advice notice — GENERAL_ANSWER_DISCLAIMER for a `general`
   * answer, GROUNDED_ANSWER_DISCLAIMER for a `grounded`/`grounded_retry` one.
   * Always set by the server, never the client.
   */
  disclaimer?: string;
  /** How many fabricated citations the guard stripped. Surfaced for honesty. */
  redactedCount?: number;
  /**
   * General-knowledge supplement for a partial gap in an otherwise grounded
   * answer (see GAP_MARKER_RE in ai/prompts.ts). Rendered as its own fenced
   * block, never merged into `content` — a lawyer must be able to tell which
   * part carries a citation and which part doesn't.
   */
  gapFill?: string | null;
  gapFillRedactedCount?: number;
  /**
   * Type-2 "hybrid" supplement: sources existed but overall retrieval
   * confidence was low, so a separate GPT legal-analysis call added broader
   * reasoning alongside the grounded, cited answer above. Every citation-shaped
   * span in it was checked against the database before reaching the client —
   * see citation-verify.ts — so unlike `gapFill` it may legitimately carry a
   * real, verified citation. Rendered as its own fenced block, never merged
   * into `content`.
   */
  hybridAnalysis?: string | null;
  hybridAnalysisVerifiedCount?: number;
  hybridAnalysisRedactedCount?: number;
  /**
   * Backend-computed answer confidence. Derived from retrieval scores, rerank
   * scores, source count and whether the named citation was matched — never
   * from the model's own opinion of itself.
   */
  confidence?: AnswerConfidence;
  pending?: boolean;
  error?: string;
};

export type AnswerConfidence = {
  /** 0..1 */
  score: number;
  label: "عالية" | "متوسطة" | "منخفضة" | "لا يوجد";
  /** Short Arabic explanation of what drove the score. */
  reason: string;
};

export type CaseAnalysis = {
  summary?: string;
  parties?: { role: string; name: string }[];
  facts?: string[];
  case_type?: string;
  cited_articles?: string[];
  legal_basis?: { point: string; citation?: string }[];
  possible_defenses?: { defense: string; citation?: string }[];
  strengths?: { point: string; citation?: string }[];
  weaknesses?: { point: string; citation?: string }[];
  gaps?: string[];
  parse_error?: boolean;
};

export const CATEGORIES = [
  "حقوقية",
  "جزائية",
  "عمالية",
  "تجارية",
  "شركات",
  "مدنية",
  "أمن دولة",
] as const;

export const COURTS = [
  "محكمة الصلح",
  "محكمة البداية",
  "محكمة الاستئناف",
  "محكمة التمييز",
  "محكمة الجنايات الكبرى",
  "محكمة أمن الدولة",
  "المحكمة الدستورية",
] as const;

export const SOURCE_TYPE_LABELS: Record<string, string> = {
  law: "قانون",
  regulation: "نظام",
  instruction: "تعليمات",
  court_decision: "قرار محكمة",
  principle: "مبدأ قانوني",
  template: "قالب صياغة",
  interpretation: "قرار تفسيري (الديوان الخاص)",
  mou: "مذكرة تفاهم",
  secondary: "مادة ثانوية",
};
