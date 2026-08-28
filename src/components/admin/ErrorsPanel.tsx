"use client";

import { useEffect, useState } from "react";

type ErrorRow = {
  id: number;
  context: string;
  message: string;
  stack: string | null;
  created_at: string;
};

type ErrorsData = {
  totals: { total: string; last_24h: string };
  byContext: { context: string; count: number }[];
  recent: ErrorRow[];
};

export function ErrorsPanel() {
  const [data, setData] = useState<ErrorsData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const res = await fetch("/api/admin/errors");
        if (!res.ok) throw new Error("تعذّر تحميل سجل الأخطاء.");
        const json = await res.json();
        if (alive) setData(json);
      } catch (err) {
        if (alive) setError((err as Error).message);
      }
    };
    load();
    const t = setInterval(load, 30_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  if (error) return <p className="text-sm text-red-400">{error}</p>;
  if (!data) return <p className="text-sm text-muted">جارٍ التحميل...</p>;

  const last24h = Number(data.totals.last_24h ?? 0);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="إجمالي الأخطاء المسجّلة" value={data.totals.total ?? 0} />
        <Stat label="آخر 24 ساعة" value={last24h} tone={last24h > 0 ? "bad" : undefined} />
      </div>

      <div className="card p-4">
        <h3 className="mb-3 text-sm font-semibold">أكثر المصادر تكراراً — آخر 7 أيام</h3>
        {data.byContext.length === 0 ? (
          <p className="text-xs text-muted">لا توجد أخطاء مسجّلة في هذه الفترة.</p>
        ) : (
          <div className="space-y-1.5">
            {data.byContext.map((c) => {
              const max = data.byContext[0].count;
              return (
                <div key={c.context} className="flex items-center gap-2">
                  <span className="w-56 shrink-0 truncate text-xs text-slate-300">{c.context}</span>
                  <div className="h-2 flex-1 overflow-hidden rounded-full bg-edge">
                    <div className="h-full rounded-full bg-red-500/70" style={{ width: `${(c.count / max) * 100}%` }} />
                  </div>
                  <span className="w-6 shrink-0 text-left text-[11px] text-muted">{c.count}</span>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="card overflow-hidden">
        <h3 className="border-b border-edge p-4 text-sm font-semibold">آخر الأخطاء</h3>
        <div className="divide-y divide-edge">
          {data.recent.map((r) => (
            <details key={r.id} className="p-3 text-xs open:bg-white/[0.02]">
              <summary className="flex cursor-pointer items-center gap-3 [&::-webkit-details-marker]:hidden">
                <span className="shrink-0 text-muted">{r.created_at}</span>
                <span className="shrink-0 rounded border border-red-900/60 px-1.5 py-0.5 text-[10px] text-red-400">
                  {r.context}
                </span>
                <span className="truncate text-slate-300">{r.message}</span>
              </summary>
              {r.stack && (
                <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-all rounded bg-black/30 p-2 text-[10px] text-slate-400">
                  {r.stack}
                </pre>
              )}
            </details>
          ))}
          {data.recent.length === 0 && <p className="p-6 text-center text-xs text-muted">لا توجد أخطاء مسجّلة بعد.</p>}
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string | number; tone?: "bad" }) {
  return (
    <div className="card p-3">
      <p className="text-[11px] text-muted">{label}</p>
      <p className={`mt-1 text-xl font-semibold ${tone === "bad" ? "text-red-400" : ""}`}>{value}</p>
    </div>
  );
}
