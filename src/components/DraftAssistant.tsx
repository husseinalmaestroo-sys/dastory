"use client";

import { useState } from "react";
import type { Citation } from "@/types";
import { SourceCard } from "./SourceCard";
import { DraftPaper } from "./DraftPaper";
import { FORMS, getForm, draftFilename, hasSubstantialNotes, type DraftKind } from "@/lib/drafting/forms";
import {
  draftToBlocks,
  blocksToDraft,
  draftToPlainText,
  countTodos,
  sectionHeadingFor,
  moveSection,
  type DraftBlock,
} from "@/lib/drafting/parse";

type RefineAction = "regenerate" | "improve" | "shorten" | "expand";

export function DraftAssistant({
  initialKind,
  initialNotes,
}: {
  /** Set when Chat's router decided a chat message was actually a drafting
   *  request — see classifyRequest in lib/drafting/classify.ts. Also what
   *  gates the "routed here automatically" banner: undefined means the
   *  lawyer opened this tab themselves. */
  initialKind?: DraftKind;
  initialNotes?: string;
} = {}) {
  const [kind, setKind] = useState<DraftKind>(initialKind ?? "statement_of_claim");
  const [values, setValues] = useState<Record<string, string>>({});
  const [notes, setNotes] = useState(initialNotes ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ grounded: boolean; sources: Citation[] } | null>(null);
  const [blocks, setBlocks] = useState<DraftBlock[] | null>(null);
  const [copied, setCopied] = useState(false);
  const [exporting, setExporting] = useState<"docx" | "pdf" | null>(null);
  const [refiningId, setRefiningId] = useState<string | null>(null);
  const [refineErrors, setRefineErrors] = useState<Record<string, string>>({});

  const form = getForm(kind);
  const setField = (id: string, v: string) => setValues((prev) => ({ ...prev, [id]: v }));

  const missing = form.groups
    .flatMap((g) => g.fields)
    .filter((f) => f.required && !values[f.id]?.trim());

  // A lawyer may describe the whole matter freely in "ملاحظات إضافية" instead
  // of filling structured boxes — substantial free text bypasses the missing-
  // required-fields block, matching route.ts's server-side check exactly so
  // the two can never disagree about whether a submission is allowed.
  const gateActive = missing.length > 0 && !hasSubstantialNotes(notes);

  const recommendedGaps = form.groups
    .flatMap((g) => g.fields)
    .filter((f) => f.recommended && !values[f.id]?.trim());

  const submit = async () => {
    if (gateActive || busy) return;
    setBusy(true);
    setError(null);
    setResult(null);
    setBlocks(null);

    try {
      const res = await fetch("/api/draft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind, fields: values, notes }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "تعذّر إنشاء المسودة.");
      setResult({ grounded: data.grounded, sources: data.sources });
      if (data.grounded) setBlocks(draftToBlocks(data.draft));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const currentDraft = blocks ? blocksToDraft(blocks) : "";
  const todos = blocks ? countTodos(currentDraft) : 0;
  const filename = draftFilename(kind, values);

  const copy = async () => {
    await navigator.clipboard.writeText(draftToPlainText(currentDraft));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const downloadTxt = () => {
    const blob = new Blob([draftToPlainText(currentDraft)], { type: "text/plain;charset=utf-8" });
    triggerDownload(blob, `${filename}.txt`);
  };

  const downloadFile = async (format: "docx" | "pdf") => {
    setExporting(format);
    try {
      const res = await fetch("/api/draft/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ draft: currentDraft, filename, format }),
      });
      if (!res.ok) throw new Error("تعذّر تصدير الملف.");
      const blob = await res.blob();
      triggerDownload(blob, `${filename}.${format}`);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setExporting(null);
    }
  };

  // Refines ONE block in place — never re-runs retrieval, so [n] in the
  // returned text still means the same source as [n] elsewhere in the
  // document (see hybrid.ts's getChunksByIds / prompts.ts's
  // buildRefineSectionPrompt). blocks/result are read fresh at click time
  // rather than closed over, since a lawyer may have edited the paragraph
  // manually since the draft was generated.
  const refineBlock = async (blockId: string, action: RefineAction) => {
    if (refiningId || !blocks || !result) return;
    const block = blocks.find((b) => b.id === blockId);
    if (!block) return;

    setRefiningId(blockId);
    setRefineErrors((prev) => {
      const next = { ...prev };
      delete next[blockId];
      return next;
    });

    try {
      const res = await fetch("/api/draft/refine", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind,
          action,
          sectionHeading: sectionHeadingFor(blocks, blockId),
          blockText: block.text,
          fullDraft: blocksToDraft(blocks),
          sourceIds: result.sources.map((s) => s.id),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "تعذّر تعديل القسم.");
      setBlocks((prev) => (prev ? prev.map((b) => (b.id === blockId ? { ...b, text: data.text } : b)) : prev));
    } catch (err) {
      setRefineErrors((prev) => ({ ...prev, [blockId]: (err as Error).message }));
    } finally {
      setRefiningId(null);
    }
  };

  const handleMoveSection = (headingBlockId: string, direction: "up" | "down") => {
    setBlocks((prev) => (prev ? moveSection(prev, headingBlockId, direction) : prev));
  };

  return (
    <div className="mx-auto max-w-3xl px-4 py-6">
      <h2 className="text-lg font-semibold">مساعد الصياغة القانونية</h2>

      {initialKind && (
        <div className="mt-3 rounded-lg border border-accent/30 bg-accent/5 px-4 py-2.5 text-xs leading-6 text-accent">
          بدا طلبك في المحادثة وكأنه طلب صياغة مستند، فتم تحويلك تلقائياً إلى نموذج &quot;{form.label}&quot;. راجع
          الحقول أدناه وأكملها، أو بدّل النوع من الأزرار أسفله إن لم يكن هذا هو المقصود.
        </div>
      )}

      <div className="mt-5 flex flex-wrap gap-2">
        {FORMS.map((f) => (
          <button
            key={f.id}
            onClick={() => {
              setKind(f.id);
              setResult(null);
              setBlocks(null);
              // Unlike `values` (keyed per field id, so a shared id like
              // "court" carrying over between kinds is harmless/expected),
              // notes is free prose describing THIS document specifically.
              // Left uncleared, substantial leftover text from a previous
              // kind could satisfy hasSubstantialNotes for a new kind whose
              // required fields were never actually filled — the free-text
              // gate bypassing validation for a document it was never
              // written about.
              setNotes("");
            }}
            className={`rounded-lg border px-3 py-1.5 text-xs transition-colors ${
              kind === f.id
                ? "border-accent bg-accent/10 text-accent"
                : "border-edge text-muted hover:border-slate-600 hover:text-slate-300"
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      <p className="mt-3 text-xs text-muted">عبّئ ما تعرفه — أي حقل فارغ يُترك في المسودة ليكمله المحامي بنفسه.</p>

      <div className="mt-5 space-y-6">
        {form.groups.map((group) => (
          <div key={group.title}>
            <h3 className="mb-2 text-xs font-semibold text-slate-300">{group.title}</h3>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {group.fields.map((f) => (
                <div key={f.id} className={f.span === 2 ? "sm:col-span-2" : undefined}>
                  <label className="mb-1 flex items-baseline gap-1 text-[11px] text-muted">
                    {f.label}
                    {f.required && <span className="text-accent">*</span>}
                  </label>
                  {f.type === "textarea" ? (
                    <textarea
                      rows={f.rows ?? 3}
                      value={values[f.id] ?? ""}
                      onChange={(e) => setField(f.id, e.target.value)}
                      placeholder={f.placeholder}
                      className="field resize-y leading-6"
                    />
                  ) : (
                    <input
                      type={f.type === "date" ? "date" : "text"}
                      value={values[f.id] ?? ""}
                      onChange={(e) => setField(f.id, e.target.value)}
                      placeholder={f.placeholder}
                      className="field"
                    />
                  )}
                  {f.hint && <p className="mt-1 text-[10px] text-muted">{f.hint}</p>}
                </div>
              ))}
            </div>
          </div>
        ))}

        <div>
          <label className="mb-1.5 block text-xs text-muted">ملاحظات إضافية (اختياري)</label>
          <textarea
            rows={3}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="أي تفاصيل أخرى تريد إدراجها في المسودة"
            className="field resize-y leading-6"
          />
        </div>
      </div>

      {error && (
        <div className="mt-4 rounded-lg border border-red-900/60 bg-red-950/40 px-4 py-3 text-sm text-red-300">
          {error}
        </div>
      )}

      <div className="mt-4 flex items-center gap-3">
        <button onClick={submit} disabled={busy || gateActive} className="btn-primary">
          {busy ? "جارٍ الصياغة..." : `إنشاء ${form.label}`}
        </button>
        {busy && <span className="text-xs text-muted">يبحث في القوالب والنصوص القانونية...</span>}
        {!busy && gateActive && (
          <span className="text-xs text-muted">
            أكمل الحقول المطلوبة: {missing.map((f) => f.label).join("، ")}، أو صف الحالة كاملة في الملاحظات الإضافية
            أدناه.
          </span>
        )}
      </div>

      {recommendedGaps.length > 0 && (
        <div className="mt-3 rounded-lg border border-amber-900/40 bg-amber-950/20 px-4 py-2.5 text-xs leading-6 text-amber-300/90">
          توجد معلومات قد تكون مهمة لإكمال العقد: {recommendedGaps.map((f) => f.label).join("، ")}. يمكنك المتابعة
          دون تعبئتها.
        </div>
      )}

      {result && (
        <div className="mt-6 space-y-4">
          {!result.grounded ? (
            <div className="card p-4">
              <p className="text-sm leading-7 text-amber-400/90">
                لم يُعثر على قوالب أو نصوص قانونية ذات صلة في قاعدة البيانات.
              </p>
              <p className="mt-2 text-xs text-muted">
                ارفع قوالب الصياغة من لوحة الإدارة بنوع &quot;قالب صياغة&quot;، أو فصّل الحقول أعلاه بمصطلحات أقرب إلى
                النصوص المخزّنة.
              </p>
            </div>
          ) : (
            blocks && (
              <>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-xs font-medium text-muted">
                    المسودة — قابلة للتعديل مباشرة
                    {todos > 0 && <span className="text-accent"> · {todos} حقل بحاجة إكمال</span>}
                  </span>
                  <div className="flex gap-2">
                    <button onClick={copy} className="btn-ghost px-2.5 py-1 text-[11px]">
                      {copied ? "تم النسخ" : "نسخ النص"}
                    </button>
                    <button onClick={downloadTxt} className="btn-ghost px-2.5 py-1 text-[11px]">
                      تنزيل نص
                    </button>
                    <button
                      onClick={() => downloadFile("docx")}
                      disabled={exporting !== null}
                      className="btn-ghost px-2.5 py-1 text-[11px]"
                    >
                      {exporting === "docx" ? "جارٍ التنزيل..." : "تنزيل Word"}
                    </button>
                    <button
                      onClick={() => downloadFile("pdf")}
                      disabled={exporting !== null}
                      className="btn-primary px-2.5 py-1 text-[11px]"
                    >
                      {exporting === "pdf" ? "جارٍ التنزيل..." : "تنزيل PDF"}
                    </button>
                  </div>
                </div>

                <DraftPaper
                  blocks={blocks}
                  onChange={setBlocks}
                  onRefine={refineBlock}
                  refiningId={refiningId}
                  refineErrors={refineErrors}
                  onMoveSection={handleMoveSection}
                />

                {result.sources.length > 0 && (
                  <details>
                    <summary className="cursor-pointer text-xs font-medium text-muted hover:text-slate-300">
                      المصادر والقوالب المستند إليها ({result.sources.length})
                    </summary>
                    <div className="mt-2 space-y-2">
                      {result.sources.map((s) => (
                        <SourceCard key={s.id} c={s} />
                      ))}
                    </div>
                  </details>
                )}

                <p className="rounded-lg border border-edge bg-panel/50 px-4 py-3 text-[11px] leading-6 text-muted">
                  هذه مسودة أولية تخضع لمراجعتك ومسؤوليتك المهنية، وليست وثيقة نهائية. راجع كل إسناد قانوني في المصادر
                  أعلاه قبل الاعتماد عليه، وأكمل الحقول المعلّمة بـ [يُستكمل: ...].
                </p>
              </>
            )
          )}
        </div>
      )}
    </div>
  );
}

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
