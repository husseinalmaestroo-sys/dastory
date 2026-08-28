"use client";

import { useState } from "react";
import type { Citation } from "@/types";
import { SOURCE_TYPE_LABELS } from "@/types";

export function SourceCard({ c }: { c: Citation }) {
  const [open, setOpen] = useState(false);

  const meta = [
    c.lawName,
    c.articleNumber ? `المادة ${c.articleNumber}` : null,
    c.court,
    c.decisionNumber ? `قرار ${c.decisionNumber}` : null,
    c.year ? String(c.year) : null,
  ].filter(Boolean);

  return (
    <div className="card overflow-hidden">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-start gap-3 p-3 text-right hover:bg-white/[0.03]"
      >
        <span className="mt-0.5 flex h-6 min-w-6 items-center justify-center rounded bg-accent/15 text-xs font-bold text-accent">
          {c.ref}
        </span>

        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium text-slate-100">{c.title}</span>
          {meta.length > 0 && (
            <span className="mt-1 block truncate text-xs text-muted">{meta.join(" · ")}</span>
          )}
        </span>

        {c.sourceType && (
          <span className="shrink-0 rounded border border-edge px-1.5 py-0.5 text-[10px] text-muted">
            {SOURCE_TYPE_LABELS[c.sourceType] ?? c.sourceType}
          </span>
        )}
      </button>

      {open && (
        <div className="border-t border-edge px-3 py-3">
          <p className="whitespace-pre-wrap text-[13px] leading-7 text-slate-300">{c.excerpt}</p>
          {c.matchedBy && (
            <p className="mt-2 text-[11px] text-muted">
              طريقة المطابقة:{" "}
              {c.matchedBy === "both" ? "دلالية + كلمات مفتاحية" : c.matchedBy === "vector" ? "دلالية" : "كلمات مفتاحية"}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
