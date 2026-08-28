"use client";

import { useCallback, useEffect, useState } from "react";
import { CATEGORIES, COURTS, SOURCE_TYPE_LABELS } from "@/types";

type Source = {
  id: number;
  title: string;
  source_type: string;
  category: string | null;
  court: string | null;
  year: number | null;
  status: "pending" | "processing" | "ready" | "failed";
  error: string | null;
  note: string | null;
  chunk_count: number;
  created_at: string;
};

export function SourcesManager() {
  const [sources, setSources] = useState<Source[]>([]);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/admin/sources");
    if (res.ok) setSources((await res.json()).sources);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="space-y-6">
      <UploadForm
        onDone={(msg) => {
          setNotice(msg);
          load();
        }}
      />

      {notice && (
        <div
          className={`rounded-lg border px-4 py-3 text-sm ${
            notice.kind === "ok"
              ? "border-emerald-900/60 bg-emerald-950/30 text-emerald-300"
              : "border-red-900/60 bg-red-950/40 text-red-300"
          }`}
        >
          {notice.text}
        </div>
      )}

      <div className="card overflow-hidden">
        <div className="flex items-center justify-between border-b border-edge p-4">
          <h3 className="text-sm font-semibold">المصادر ({sources.length})</h3>
          <button onClick={load} className="btn-ghost px-3 py-1 text-xs">
            تحديث
          </button>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-right text-xs">
            <thead className="bg-white/[0.02] text-muted">
              <tr>
                <th className="p-3 font-medium">العنوان</th>
                <th className="p-3 font-medium">النوع</th>
                <th className="p-3 font-medium">التصنيف</th>
                <th className="p-3 font-medium">المحكمة</th>
                <th className="p-3 font-medium">السنة</th>
                <th className="p-3 font-medium">المقاطع</th>
                <th className="p-3 font-medium">الحالة</th>
                <th className="p-3 font-medium">إجراءات</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={8} className="p-6 text-center text-muted">
                    جارٍ التحميل...
                  </td>
                </tr>
              ) : sources.length === 0 ? (
                <tr>
                  <td colSpan={8} className="p-6 text-center text-muted">
                    لا توجد مصادر بعد. ارفع أول قانون أو قرار من النموذج أعلاه.
                  </td>
                </tr>
              ) : (
                sources.map((s) => (
                  <Row
                    key={s.id}
                    s={s}
                    onChanged={load}
                    onNotice={setNotice}
                  />
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function Row({
  s,
  onChanged,
  onNotice,
}: {
  s: Source;
  onChanged: () => void;
  onNotice: (n: { kind: "ok" | "err"; text: string }) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState({
    title: s.title,
    category: s.category ?? "",
    court: s.court ?? "",
    year: s.year ?? "",
  });

  const save = async () => {
    setBusy(true);
    const res = await fetch(`/api/admin/sources/${s.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: draft.title,
        category: draft.category || null,
        court: draft.court || null,
        year: draft.year === "" ? null : Number(draft.year),
      }),
    });
    setBusy(false);
    if (res.ok) {
      setEditing(false);
      onChanged();
    } else {
      const d = await res.json().catch(() => ({}));
      onNotice({ kind: "err", text: d.error ?? "فشل التعديل." });
    }
  };

  const reindex = async () => {
    // Re-embedding costs real money and minutes of CPU on the VPS — worth a
    // confirm, since the button sits next to Delete.
    if (!confirm(`إعادة بناء الـ embeddings للمصدر "${s.title}"؟ قد يستغرق دقائق ويستهلك رصيد OpenAI.`)) return;
    setBusy(true);
    const res = await fetch(`/api/admin/sources/${s.id}/reindex`, { method: "POST" });
    const d = await res.json().catch(() => ({}));
    setBusy(false);
    onNotice(
      res.ok
        ? { kind: "ok", text: `تمت إعادة الفهرسة: ${d.chunks} مقطع.` }
        : { kind: "err", text: d.error ?? "فشلت إعادة الفهرسة." }
    );
    onChanged();
  };

  const remove = async () => {
    if (!confirm(`حذف "${s.title}" نهائياً من قاعدة البيانات؟ ستُحذف كل مقاطعه المفهرسة.`)) return;
    setBusy(true);
    const res = await fetch(`/api/admin/sources/${s.id}`, { method: "DELETE" });
    setBusy(false);
    if (res.ok) onChanged();
    else onNotice({ kind: "err", text: "فشل الحذف." });
  };

  if (editing) {
    return (
      <tr className="border-t border-edge bg-white/[0.02]">
        <td className="p-2">
          <input className="field py-1" value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
        </td>
        <td className="p-2 text-muted">{SOURCE_TYPE_LABELS[s.source_type]}</td>
        <td className="p-2">
          <select className="field py-1" value={draft.category} onChange={(e) => setDraft({ ...draft, category: e.target.value })}>
            <option value="">—</option>
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </td>
        <td className="p-2">
          <select className="field py-1" value={draft.court} onChange={(e) => setDraft({ ...draft, court: e.target.value })}>
            <option value="">—</option>
            {COURTS.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </td>
        <td className="p-2">
          <input
            type="number"
            className="field w-20 py-1"
            value={draft.year}
            onChange={(e) => setDraft({ ...draft, year: e.target.value })}
          />
        </td>
        <td className="p-2 text-muted">{s.chunk_count}</td>
        <td className="p-2" />
        <td className="p-2">
          <div className="flex gap-1">
            <button onClick={save} disabled={busy} className="btn-primary px-2 py-1 text-[11px]">
              حفظ
            </button>
            <button onClick={() => setEditing(false)} className="btn-ghost px-2 py-1 text-[11px]">
              إلغاء
            </button>
          </div>
        </td>
      </tr>
    );
  }

  return (
    <tr className="border-t border-edge">
      <td className="max-w-xs p-3">
        <div className="truncate text-slate-200">{s.title}</div>
        {s.status === "failed" && s.error && <div className="mt-1 text-[10px] text-red-400">{s.error}</div>}
        {/* Not truncated, unlike the title: this is the caveat that tells the
            admin the source's article numbers were withheld, and a caveat
            nobody reads is not a caveat. */}
        {s.note && <div className="mt-1 text-[10px] leading-4 text-amber-400/90">{s.note}</div>}
      </td>
      <td className="p-3 text-muted">{SOURCE_TYPE_LABELS[s.source_type] ?? s.source_type}</td>
      <td className="p-3 text-muted">{s.category ?? "—"}</td>
      <td className="p-3 text-muted">{s.court ?? "—"}</td>
      <td className="p-3 text-muted">{s.year ?? "—"}</td>
      <td className="p-3 text-muted">{s.chunk_count}</td>
      <td className="p-3">
        <StatusBadge status={s.status} />
      </td>
      <td className="p-3">
        <div className="flex gap-1">
          <button onClick={() => setEditing(true)} disabled={busy} className="btn-ghost px-2 py-1 text-[11px]">
            تعديل
          </button>
          <button onClick={reindex} disabled={busy} className="btn-ghost px-2 py-1 text-[11px]">
            {busy ? "..." : "إعادة فهرسة"}
          </button>
          <button
            onClick={remove}
            disabled={busy}
            className="btn px-2 py-1 text-[11px] text-red-400 hover:bg-red-950/40"
          >
            حذف
          </button>
        </div>
      </td>
    </tr>
  );
}

function StatusBadge({ status }: { status: Source["status"] }) {
  const map = {
    ready: ["جاهز", "text-emerald-400 border-emerald-900/60"],
    processing: ["قيد المعالجة", "text-amber-400 border-amber-900/60"],
    pending: ["بالانتظار", "text-muted border-edge"],
    failed: ["فشل", "text-red-400 border-red-900/60"],
  } as const;
  const [label, cls] = map[status];
  return <span className={`rounded border px-1.5 py-0.5 text-[10px] ${cls}`}>{label}</span>;
}

/** law | regulation | instruction — the types the validation gate treats as
 *  legislation and requires full citation identity for. */
const LEGISLATION_TYPES = ["law", "regulation", "instruction"];

type BaseLaw = { id: number; title: string; law_number: string | null; year: number | null };

function UploadForm({ onDone }: { onDone: (n: { kind: "ok" | "err"; text: string }) => void }) {
  const [busy, setBusy] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [form, setForm] = useState({
    title: "",
    source_type: "law",
    category: "",
    court: "",
    year: "",
    law_number: "",
    effective_date: "",
    amendment_of: "",
  });
  const [bases, setBases] = useState<BaseLaw[]>([]);

  const isLegislation = LEGISLATION_TYPES.includes(form.source_type);
  // A title starting with معدّل/معدل is an amending act — it MUST be linked to
  // its base, so we surface the dropdown prominently and require it.
  const looksAmending = /^\s*(?:ال)?(?:قانون|نظام|تعليمات)?\s*معد[ّ]?ل/.test(form.title.trim());

  // Load the base-law list once, for the "يعدّل القانون" dropdown.
  useEffect(() => {
    fetch("/api/admin/sources?bases=1")
      .then((r) => (r.ok ? r.json() : { bases: [] }))
      .then((d) => setBases(d.bases ?? []))
      .catch(() => setBases([]));
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file || busy) return;

    setBusy(true);
    const fd = new FormData();
    fd.append("file", file);
    // Non-legislation carries no law number / effective date / amendment link —
    // don't send those fields for a court decision or template.
    const send: Record<string, string> = isLegislation
      ? form
      : { title: form.title, source_type: form.source_type, category: form.category, court: form.court, year: form.year };
    Object.entries(send).forEach(([k, v]) => v && fd.append(k, v));

    const res = await fetch("/api/admin/sources", { method: "POST", body: fd });
    const d = await res.json().catch(() => ({}));
    setBusy(false);

    if (res.ok) {
      onDone({
        kind: "ok",
        text: `تمت الفهرسة: ${d.chunks} مقطع من ${d.pages} صفحة (${d.method === "ocr" ? "OCR" : d.method === "hybrid" ? "مختلط" : "نص مباشر"}).`,
      });
      setFile(null);
      setForm({ title: "", source_type: "law", category: "", court: "", year: "", law_number: "", effective_date: "", amendment_of: "" });
      (e.target as HTMLFormElement).reset();
    } else {
      onDone({ kind: "err", text: d.error ?? "فشل الرفع." });
    }
  };

  return (
    <form onSubmit={submit} className="card p-4">
      <h3 className="mb-3 text-sm font-semibold">رفع مصدر قانوني</h3>

      <div className="grid gap-3 md:grid-cols-2">
        <input
          className="field"
          placeholder="العنوان (مثال: قانون العمل الأردني رقم 8 لسنة 1996)"
          value={form.title}
          onChange={(e) => setForm({ ...form, title: e.target.value })}
          required
        />

        <select
          className="field"
          value={form.source_type}
          onChange={(e) => setForm({ ...form, source_type: e.target.value })}
        >
          {Object.entries(SOURCE_TYPE_LABELS).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>

        <select className="field" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
          <option value="">التصنيف (اختياري)</option>
          {CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>

        <select className="field" value={form.court} onChange={(e) => setForm({ ...form, court: e.target.value })}>
          <option value="">المحكمة (اختياري)</option>
          {COURTS.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>

        <input
          type="number"
          className="field"
          placeholder={isLegislation ? "السنة (لسنة …) — مطلوبة" : "السنة (اختياري)"}
          value={form.year}
          onChange={(e) => setForm({ ...form, year: e.target.value })}
          required={isLegislation}
        />

        <input
          type="file"
          accept="application/pdf,.pdf"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          className="field file:ml-3 file:rounded file:border-0 file:bg-edge file:px-3 file:py-1 file:text-xs file:text-slate-200"
          required
        />

        {/* Legislation-only: the citation identity the validation gate requires.
            Hidden for court decisions / principles / templates, which have no
            law number or effective date. */}
        {isLegislation && (
          <>
            <input
              className="field"
              placeholder="رقم القانون (مثال: 8) — مطلوب"
              value={form.law_number}
              onChange={(e) => setForm({ ...form, law_number: e.target.value })}
              required
            />

            <label className="flex items-center gap-2 text-xs text-muted">
              <span className="shrink-0">تاريخ النفاذ:</span>
              <input
                type="date"
                className="field"
                value={form.effective_date}
                onChange={(e) => setForm({ ...form, effective_date: e.target.value })}
                required
              />
            </label>

            <select
              className={`field md:col-span-2 ${looksAmending && !form.amendment_of ? "border-amber-700/70" : ""}`}
              value={form.amendment_of}
              onChange={(e) => setForm({ ...form, amendment_of: e.target.value })}
              required={looksAmending}
            >
              <option value="">
                {looksAmending ? "يعدّل القانون — مطلوب (هذا قانون معدّل)" : "يعدّل القانون (اتركه فارغاً لقانون أصلي)"}
              </option>
              {bases.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.title}
                  {b.law_number ? ` — رقم ${b.law_number}` : ""}
                  {b.year ? `/${b.year}` : ""}
                </option>
              ))}
            </select>
          </>
        )}
      </div>

      <div className="mt-3 flex items-center gap-3">
        <button type="submit" disabled={busy || !file} className="btn-primary">
          {busy ? "جارٍ الرفع والفهرسة..." : "رفع وفهرسة"}
        </button>
        <p className="text-[11px] text-muted">
          {isLegislation
            ? "القانون والنظام والتعليمات: الاسم والرقم والسنة وتاريخ النفاذ مطلوبة. القانون المعدّل يجب ربطه بالأصلي."
            : "القيمة التي تُدخلها تتقدّم دائماً على الاستخراج التلقائي من الملف."}
        </p>
      </div>
    </form>
  );
}
