"use client";

import { useCallback, useEffect, useRef, useState } from "react";

const SIZE = 30;
const STROKE = 3;
const RADIUS = (SIZE - STROKE) / 2;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;
const POLL_MS = 45_000;

/**
 * Ring gauge for "how much of today's usage is left" — percentage only, by
 * construction: it reads `pct` off /api/usage, which never puts a dollar
 * figure on the wire in the first place (see that route's own comment). No
 * amount, no cap, no cost — just a fraction of a day.
 *
 * `refreshOn` lets the caller force an immediate refetch (Chat.tsx passes its
 * `busy` flag so the ring updates right after a question finishes) on top of
 * the periodic poll below, which alone would catch usage from case-upload or
 * drafting even when the lawyer never sends another chat message.
 */
export function UsageMeter({ refreshOn }: { refreshOn?: unknown }) {
  const [pct, setPct] = useState<number | null>(null);
  const inFlight = useRef(false);

  const fetchPct = useCallback(() => {
    if (inFlight.current) return;
    inFlight.current = true;
    fetch("/api/usage")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data && typeof data.pct === "number") setPct(Math.max(0, Math.min(100, data.pct)));
      })
      // Silent on purpose: an auxiliary status ring must never surface an
      // error banner over the lawyer's actual work.
      .catch(() => {})
      .finally(() => {
        inFlight.current = false;
      });
  }, []);

  useEffect(() => {
    fetchPct();
    const id = setInterval(fetchPct, POLL_MS);
    return () => clearInterval(id);
  }, [fetchPct]);

  // eslint-disable-next-line react-hooks/exhaustive-deps -- deliberate: refetch whenever the caller's trigger value changes, not on fetchPct identity.
  useEffect(() => {
    if (refreshOn === undefined) return;
    fetchPct();
  }, [refreshOn]);

  if (pct === null) return null;

  const tone =
    pct < 60
      ? { ring: "#10b981", text: "text-emerald-300" } // emerald-500
      : pct < 90
        ? { ring: "#f59e0b", text: "text-amber-300" } // amber-500
        : { ring: "#ef4444", text: "text-red-300" }; // red-500

  const offset = CIRCUMFERENCE * (1 - pct / 100);

  return (
    <div
      className="relative shrink-0 rounded-lg border border-edge p-0.5"
      style={{ width: SIZE + 4, height: SIZE + 4 }}
      title={`استخدامك اليومي: ${pct}٪`}
      aria-label={`استخدامك اليومي ${pct} بالمئة`}
    >
      <svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`} className="-rotate-90">
        <circle cx={SIZE / 2} cy={SIZE / 2} r={RADIUS} fill="none" stroke="#262b36" strokeWidth={STROKE} />
        <circle
          cx={SIZE / 2}
          cy={SIZE / 2}
          r={RADIUS}
          fill="none"
          stroke={tone.ring}
          strokeWidth={STROKE}
          strokeLinecap="round"
          strokeDasharray={CIRCUMFERENCE}
          strokeDashoffset={offset}
          style={{ transition: "stroke-dashoffset 0.4s ease, stroke 0.4s ease" }}
        />
      </svg>
      <span
        className={`absolute inset-0 flex items-center justify-center text-[9px] font-semibold tabular-nums ${tone.text}`}
      >
        {pct}٪
      </span>
    </div>
  );
}
