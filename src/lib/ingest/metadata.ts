import "server-only";
import { normalizeDigits } from "./clean";

export type DecisionMeta = {
  decisionNumber: string | null;
  court: string | null;
  year: number | null;
  legalPrinciple: string | null;
};

const COURT_PATTERNS: [RegExp, string][] = [
  [/محكمة\s*التمييز|تمييز\s*(?:حقوق|جزاء)/, "محكمة التمييز"],
  [/محكمة\s*الاستئناف|استئناف/, "محكمة الاستئناف"],
  [/محكمة\s*(?:البداية|بداية)/, "محكمة البداية"],
  [/محكمة\s*الصلح/, "محكمة الصلح"],
  [/محكمة\s*أمن\s*الدولة/, "محكمة أمن الدولة"],
  [/المحكمة\s*الدستورية/, "المحكمة الدستورية"],
  [/محكمة\s*الجنايات\s*الكبرى/, "محكمة الجنايات الكبرى"],
];

/**
 * Best-effort header parsing from a decision's raw text.
 *
 * Every field is nullable and every caller must treat it as a *hint*: the
 * admin form's value always wins. A regex that guesses the wrong decision
 * number would put a fabricated citation in front of a lawyer, which is the
 * one failure this system exists to prevent — so when unsure, we return null
 * and let a human fill it in.
 */
export function extractDecisionMeta(text: string): DecisionMeta {
  const head = normalizeDigits(text.slice(0, 3000));

  return {
    decisionNumber: matchDecisionNumber(head),
    court: COURT_PATTERNS.find(([re]) => re.test(head))?.[1] ?? null,
    year: matchYear(head),
    legalPrinciple: matchPrinciple(text),
  };
}

function matchDecisionNumber(head: string): string | null {
  const patterns = [
    /(?:رقم\s*)?(?:القرار|الحكم|الدعوى|الطعن)\s*(?:رقم)?\s*[:\s]\s*\(?\s*(\d{1,6})\s*[/\-]\s*(\d{4})/,
    /(?:قرار|حكم)\s*(?:تمييز\s*)?(?:حقوق|جزاء)?\s*رقم\s*\(?\s*(\d{1,6})\s*[/\-]\s*(\d{4})/,
    /رقم\s*\(?\s*(\d{1,6})\s*[/\-]\s*(\d{4})\s*\)?/,
  ];
  for (const re of patterns) {
    const m = head.match(re);
    if (m) return `${m[1]}/${m[2]}`;
  }
  return null;
}

function matchYear(head: string): number | null {
  const now = new Date().getFullYear();
  const explicit = head.match(/(?:لسنة|سنة|عام)\s*(\d{4})/);
  if (explicit) {
    const y = Number(explicit[1]);
    if (y >= 1900 && y <= now + 1) return y;
  }
  // Fall back to the newest plausible year in the header — a decision's own
  // year is normally the latest one it mentions.
  const all = [...head.matchAll(/\b(19\d{2}|20\d{2})\b/g)]
    .map((m) => Number(m[1]))
    .filter((y) => y >= 1900 && y <= now + 1);
  return all.length ? Math.max(...all) : null;
}

function matchPrinciple(text: string): string | null {
  const m = text.match(/(?:المبدأ|المبادئ)\s*(?:القانوني(?:ة)?)?\s*[:\-]\s*([\s\S]{20,600}?)(?:\n\s*\n|$)/);
  return m ? m[1].trim().replace(/\s+/g, " ") : null;
}

/** "قانون أصول المحاكمات المدنية رقم 24 لسنة 1988" → law name, without the number tail. */
export function extractLawName(text: string, fallbackTitle: string): string {
  const m = text.slice(0, 2000).match(/(?:قانون|نظام|تعليمات)\s+([؀-ۿ\s]{4,70}?)(?:\s*رقم\s*\(?\s*\d|\s*لسنة\s*\d|\n)/);
  if (m) {
    const kind = text.slice(0, 2000).match(/(قانون|نظام|تعليمات)/)?.[1] ?? "قانون";
    return `${kind} ${m[1].trim()}`.replace(/\s+/g, " ");
  }
  return fallbackTitle;
}
