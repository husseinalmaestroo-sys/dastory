"use client";

import { useEffect, useState } from "react";

type Stats = {
  totals: Record<string, string>;
  sources: Record<string, string>;
  topics: { word: string; count: number }[];
  daily: { day: string; questions: number; sessions: number }[];
  recent: {
    id: number;
    question: string;
    grounded: boolean;
    mode: "grounded" | "general" | "refused" | null;
    latency_ms: number | null;
    source_count: number;
    created_at: string;
  }[];
};

export function StatsPanel() {
  const [data, setData] = useState<Stats | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const res = await fetch("/api/admin/stats");
        if (!res.ok) throw new Error("تعذّر تحميل الإحصائيات.");
        const json = await res.json();
        if (alive) setData(json);
      } catch (err) {
        if (alive) setError((err as Error).message);
      }
    };
    load();
    const t = setInterval(load, 30_000);
    // Without this the interval keeps firing after unmount and setState warns.
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  if (error) return <p className="text-sm text-red-400">{error}</p>;
  if (!data) return <p className="text-sm text-muted">جارٍ التحميل...</p>;

  const t = data.totals;
  const s = data.sources;
  const cost = Number(t.estimated_cost ?? 0);
  const answered = Number(t.total_questions) - Number(t.unanswered);
  const groundedPct = Number(t.total_questions) > 0 ? Math.round((answered / Number(t.total_questions)) * 100) : 0;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="زوار تقريبيون" value={t.approx_visitors} hint="حسب بصمة IP المُشفّرة" />
        <Stat label="إجمالي الجلسات" value={t.total_sessions} />
        <Stat label="جلسات نشطة" value={t.active_sessions} hint="آخر 30 دقيقة" />
        <Stat label="إجمالي الأسئلة" value={t.total_questions} />
        <Stat label="استهلاك Tokens" value={Number(t.total_tokens).toLocaleString("en-US")} />
        <Stat label="التكلفة التقديرية" value={`$${cost.toFixed(4)}`} hint="تقدير داخلي وليس فاتورة" />
        <Stat
          label="نسبة الإجابات المُسنَدة"
          value={`${groundedPct}%`}
          hint={`${t.general_answers ?? 0} عامة · ${t.refused_answers ?? 0} مرفوضة`}
        />
        <Stat label="متوسط زمن الرد" value={`${Math.round(Number(t.avg_latency_ms))} ms`} />
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <Stat label="المصادر" value={s.total_sources} small />
        <Stat label="جاهزة" value={s.ready_sources} small />
        <Stat label="فاشلة" value={s.failed_sources} small tone={Number(s.failed_sources) > 0 ? "bad" : undefined} />
        <Stat label="المقاطع المفهرسة" value={Number(s.total_chunks).toLocaleString("en-US")} small />
        <Stat label="ملفات مرفوعة" value={t.uploaded_cases} small />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="card p-4">
          <h3 className="mb-3 text-sm font-semibold">النشاط — آخر 14 يوماً</h3>
          <DailyChart data={data.daily} />
        </div>

        <div className="card p-4">
          <h3 className="mb-3 text-sm font-semibold">أكثر المواضيع بحثاً</h3>
          {data.topics.length === 0 ? (
            <p className="text-xs text-muted">لا توجد بيانات بعد.</p>
          ) : (
            <div className="space-y-1.5">
              {data.topics.map((tp) => {
                const max = data.topics[0].count;
                return (
                  <div key={tp.word} className="flex items-center gap-2">
                    <span className="w-28 shrink-0 truncate text-xs text-slate-300">{tp.word}</span>
                    <div className="h-2 flex-1 overflow-hidden rounded-full bg-edge">
                      <div className="h-full rounded-full bg-accent" style={{ width: `${(tp.count / max) * 100}%` }} />
                    </div>
                    <span className="w-6 shrink-0 text-left text-[11px] text-muted">{tp.count}</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      <div className="card overflow-hidden">
        <h3 className="border-b border-edge p-4 text-sm font-semibold">آخر الأسئلة</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-right text-xs">
            <thead className="bg-white/[0.02] text-muted">
              <tr>
                <th className="p-3 font-medium">السؤال</th>
                <th className="p-3 font-medium">النوع</th>
                <th className="p-3 font-medium">المصادر</th>
                <th className="p-3 font-medium">الزمن</th>
                <th className="p-3 font-medium">التاريخ</th>
              </tr>
            </thead>
            <tbody>
              {data.recent.map((r) => (
                <tr key={r.id} className="border-t border-edge">
                  <td className="max-w-md truncate p-3 text-slate-300">{r.question}</td>
                  <td className="p-3">
                    <ModeBadge mode={r.mode} grounded={r.grounded} />
                  </td>
                  <td className="p-3 text-muted">{r.source_count}</td>
                  <td className="p-3 text-muted">{r.latency_ms ? `${r.latency_ms}ms` : "—"}</td>
                  <td className="p-3 text-muted">{r.created_at}</td>
                </tr>
              ))}
              {data.recent.length === 0 && (
                <tr>
                  <td colSpan={5} className="p-6 text-center text-muted">
                    لا توجد أسئلة بعد.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

/**
 * Names which outcome produced an answer.
 *
 * A plain grounded yes/no stopped being enough once the general fallback
 * existed: "no" now covers both "answered from general knowledge" (fine) and
 * "refused for lack of a source" (names a law worth uploading). Collapsing
 * those into one label hides the only row the admin can act on.
 *
 * "grounded_retry": chat/route.ts detected a FALSE refusal — real sources had
 * already cleared search/confidence.ts's relevance gate, but the first
 * generation attempt refused anyway — and recovered automatically (a
 * forced-grounding retry, or as a last resort a direct excerpt of the
 * retrieved text with no model call at all). `grounded` is true for these
 * rows precisely like a normal "grounded" row; the distinct label exists so
 * the admin can see how often generation needed the second attempt, since
 * that number hidden inside "مُسنَد" would look identical to an answer that
 * never had a problem.
 *
 * `mode` is null on rows written before the column existed — fall back to the
 * old grounded flag rather than mislabel them.
 */
function ModeBadge({ mode, grounded }: { mode: string | null; grounded: boolean }) {
  const resolved = mode ?? (grounded ? "grounded" : "refused");
  const map: Record<string, [string, string]> = {
    grounded: ["مُسنَد", "text-emerald-400 border-emerald-900/60"],
    grounded_retry: ["مُسنَد (بعد إعادة محاولة)", "text-emerald-400 border-emerald-900/60"],
    general: ["عام", "text-amber-400 border-amber-900/60"],
    refused: ["مرفوض", "text-slate-400 border-edge"],
  };
  const [label, cls] = map[resolved] ?? map.refused;
  return <span className={`rounded border px-1.5 py-0.5 text-[10px] ${cls}`}>{label}</span>;
}

function Stat({
  label,
  value,
  hint,
  small,
  tone,
}: {
  label: string;
  value: string | number;
  hint?: string;
  small?: boolean;
  tone?: "bad";
}) {
  return (
    <div className="card p-3">
      <p className="text-[11px] text-muted">{label}</p>
      <p className={`mt-1 font-semibold ${small ? "text-base" : "text-xl"} ${tone === "bad" ? "text-red-400" : ""}`}>
        {value}
      </p>
      {hint && <p className="mt-0.5 text-[10px] text-muted">{hint}</p>}
    </div>
  );
}

/** Inline bar chart — a charting lib would be ~100KB for one panel. */
function DailyChart({ data }: { data: { day: string; questions: number; sessions: number }[] }) {
  const max = Math.max(1, ...data.map((d) => d.questions));

  return (
    <div className="flex h-32 items-end gap-1">
      {data.map((d) => (
        <div key={d.day} className="group relative flex flex-1 flex-col items-center justify-end">
          <div
            className="w-full rounded-t bg-accent/70 transition-colors group-hover:bg-accent"
            style={{ height: `${(d.questions / max) * 100}%`, minHeight: d.questions ? "3px" : "0" }}
          />
          <span className="mt-1 text-[9px] text-muted">{d.day.slice(8)}</span>
          <span className="pointer-events-none absolute bottom-full mb-1 hidden whitespace-nowrap rounded bg-ink px-2 py-1 text-[10px] text-slate-200 shadow group-hover:block">
            {d.day}: {d.questions} سؤال · {d.sessions} جلسة
          </span>
        </div>
      ))}
    </div>
  );
}
