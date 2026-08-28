"use client";

import { useState } from "react";
import type { CaseAnalysis, Citation } from "@/types";
import { SourceCard } from "./SourceCard";

type Result = { analysis: CaseAnalysis; sources: Citation[]; fileName: string; extractionMethod: string };

export function CaseUpload() {
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [drag, setDrag] = useState(false);

  const upload = async () => {
    if (!file || busy) return;
    setBusy(true);
    setError(null);
    setResult(null);

    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/cases", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "فشل التحليل.");
      setResult(data);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const pick = (f: File | undefined) => {
    if (!f) return;
    if (!f.name.toLowerCase().endsWith(".pdf")) {
      setError("يُقبل ملف PDF فقط.");
      return;
    }
    setError(null);
    setFile(f);
  };

  return (
    <div className="mx-auto max-w-3xl px-4 py-6">
      <h2 className="text-lg font-semibold">تحليل ملف قضية</h2>
      <p className="mt-1 text-sm leading-7 text-muted">
        ارفع ملف القضية بصيغة PDF. يستخرج النظام الوقائع والأطراف والمواد المذكورة، ثم يبني التكييف والدفوع اعتماداً على
        المصادر القانونية المخزّنة حصراً.
      </p>

      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDrag(true);
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDrag(false);
          pick(e.dataTransfer.files[0]);
        }}
        className={`mt-5 rounded-xl border-2 border-dashed p-8 text-center transition-colors ${
          drag ? "border-accent bg-accent/5" : "border-edge"
        }`}
      >
        <input
          id="case-file"
          type="file"
          accept="application/pdf,.pdf"
          className="hidden"
          onChange={(e) => pick(e.target.files?.[0])}
        />
        <label htmlFor="case-file" className="cursor-pointer text-sm text-slate-300">
          {file ? (
            <span className="font-medium text-accent">{file.name}</span>
          ) : (
            <>
              اسحب الملف هنا أو <span className="text-accent underline">اختر ملفاً</span>
            </>
          )}
        </label>
        <p className="mt-2 text-xs text-muted">PDF فقط · حتى 20MB · يُدعم المسح الضوئي عبر OCR</p>
      </div>

      {error && (
        <div className="mt-4 rounded-lg border border-red-900/60 bg-red-950/40 px-4 py-3 text-sm text-red-300">
          {error}
        </div>
      )}

      <div className="mt-4 flex items-center gap-3">
        <button onClick={upload} disabled={!file || busy} className="btn-primary">
          {busy ? "جارٍ التحليل..." : "تحليل الملف"}
        </button>
        {busy && <span className="text-xs text-muted">قد يستغرق التحليل دقيقة أو أكثر للملفات الممسوحة ضوئياً.</span>}
      </div>

      {result && <AnalysisView result={result} />}
    </div>
  );
}

function AnalysisView({ result }: { result: Result }) {
  const a = result.analysis;

  if (a.parse_error) {
    return (
      <div className="mt-6 card p-4">
        <p className="mb-2 text-xs text-muted">تعذّر تنسيق التحليل. النص كما ورد:</p>
        <p className="whitespace-pre-wrap text-sm leading-7">{a.summary}</p>
      </div>
    );
  }

  return (
    <div className="mt-6 space-y-4">
      {result.extractionMethod !== "text-layer" && (
        <p className="text-xs text-amber-400/80">
          تم استخراج النص عبر OCR — قد تحتوي النتيجة على أخطاء قراءة. راجع الأصل عند الاعتماد عليها.
        </p>
      )}

      {a.summary && (
        <Section title="ملخص القضية">
          <p className="text-sm leading-7 text-slate-300">{a.summary}</p>
        </Section>
      )}

      {a.case_type && (
        <Section title="نوع القضية">
          <span className="rounded border border-edge px-2 py-1 text-xs text-accent">{a.case_type}</span>
        </Section>
      )}

      {a.parties?.length ? (
        <Section title="الأطراف">
          <ul className="space-y-1 text-sm text-slate-300">
            {a.parties.map((p, i) => (
              <li key={i}>
                <span className="text-muted">{p.role}:</span> {p.name}
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      {a.facts?.length ? (
        <Section title="الوقائع">
          <List items={a.facts} />
        </Section>
      ) : null}

      {a.cited_articles?.length ? (
        <Section title="المواد القانونية المذكورة في الملف">
          <List items={a.cited_articles} />
        </Section>
      ) : null}

      {a.legal_basis?.length ? (
        <Section title="التكييف القانوني">
          <CitedList items={a.legal_basis.map((x) => ({ text: x.point, citation: x.citation }))} />
        </Section>
      ) : null}

      {a.possible_defenses?.length ? (
        <Section title="الدفوع المحتملة">
          <CitedList items={a.possible_defenses.map((x) => ({ text: x.defense, citation: x.citation }))} />
        </Section>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2">
        {a.strengths?.length ? (
          <Section title="نقاط القوة" tone="good">
            <CitedList items={a.strengths.map((x) => ({ text: x.point, citation: x.citation }))} />
          </Section>
        ) : null}

        {a.weaknesses?.length ? (
          <Section title="نقاط الضعف" tone="bad">
            <CitedList items={a.weaknesses.map((x) => ({ text: x.point, citation: x.citation }))} />
          </Section>
        ) : null}
      </div>

      {a.gaps?.length ? (
        <Section title="ما لا يوجد له سند في قاعدة البيانات">
          <List items={a.gaps} />
          <p className="mt-2 text-xs text-muted">
            هذه النقاط لم يُعثر لها على مصدر قانوني مخزّن، ولم يُقدَّم بشأنها أي استنتاج.
          </p>
        </Section>
      ) : null}

      {result.sources?.length ? (
        <Section title={`المصادر القانونية المستند إليها (${result.sources.length})`}>
          <div className="space-y-2">
            {result.sources.map((s) => (
              <SourceCard key={s.id} c={s} />
            ))}
          </div>
        </Section>
      ) : null}
    </div>
  );
}

function Section({
  title,
  children,
  tone,
}: {
  title: string;
  children: React.ReactNode;
  tone?: "good" | "bad";
}) {
  const accent = tone === "good" ? "text-emerald-400" : tone === "bad" ? "text-red-400" : "text-slate-100";
  return (
    <div className="card p-4">
      <h3 className={`mb-2 text-sm font-semibold ${accent}`}>{title}</h3>
      {children}
    </div>
  );
}

function List({ items }: { items: string[] }) {
  return (
    <ul className="list-inside list-disc space-y-1 text-sm leading-7 text-slate-300">
      {items.map((t, i) => (
        <li key={i}>{t}</li>
      ))}
    </ul>
  );
}

function CitedList({ items }: { items: { text: string; citation?: string }[] }) {
  return (
    <ul className="space-y-2 text-sm leading-7 text-slate-300">
      {items.map((it, i) => (
        <li key={i} className="flex gap-2">
          <span className="text-muted">•</span>
          <span>
            {it.text}
            {it.citation && <sup className="cite mr-1">{it.citation.replace(/[\[\]]/g, "")}</sup>}
          </span>
        </li>
      ))}
    </ul>
  );
}
