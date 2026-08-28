"use client";

import { useEffect, useRef, useState } from "react";
import { useChat, type Filters } from "./useChat";
import { AnswerText } from "./AnswerText";
import { SourceCard } from "./SourceCard";
import { CaseUpload } from "./CaseUpload";
import { DraftAssistant } from "./DraftAssistant";
import { Logo } from "./Logo";
import { UsageMeter } from "./UsageMeter";
import { LogoutButton } from "./LawyerGate";
import { classifyRequest } from "@/lib/drafting/classify";
import type { DraftKind } from "@/lib/drafting/forms";
import {
  formatWhen,
  loadConversations,
  saveConversations,
  upsertConversation,
  type Conversation,
} from "@/lib/history";
import { CATEGORIES, COURTS, type ChatMessage as ChatMessageType } from "@/types";

const EXAMPLES = [
  "ما شروط فسخ عقد المقاولة حسب القانون الأردني؟",
  "ما هي مدة التقادم في الدعاوى العمالية؟",
  "أبحث عن أحكام مشابهة لقضية تعويض عن ضرر.",
  "ما المبدأ المستقر لدى محكمة التمييز في الإثراء بلا سبب؟",
];

export function Chat({ onLogout }: { onLogout: () => void }) {
  const { messages, busy, send, stop, reset, setMessages } = useChat();
  const [input, setInput] = useState("");
  const [filters, setFilters] = useState<Filters>({});
  const [showFilters, setShowFilters] = useState(false);
  const [tab, setTab] = useState<"chat" | "case" | "draft">("chat");
  // Set only when Chat's router (classifyRequest) redirected a chat message
  // here — the key forces DraftAssistant to remount with fresh initial state
  // on every redirect, since its own useState only reads its initial props
  // once. Manually opening "صياغة" leaves this null, so the auto-routed
  // banner only shows up when it's actually true.
  const [routedDraft, setRoutedDraft] = useState<{ kind: DraftKind; notes: string; key: number } | null>(null);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  // Which stored conversation the transcript on screen belongs to. Assigned on
  // the client only — a uuid picked during render would differ from the one the
  // server rendered and break hydration.
  const [convId, setConvId] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    setConversations(loadConversations());
    setConvId(crypto.randomUUID());
  }, []);

  // Persist once a turn settles, so a half-streamed answer never lands in the
  // history and the transcript survives a reload.
  useEffect(() => {
    if (busy || !convId || messages.length === 0) return;
    setConversations((prev) => {
      const next = upsertConversation(prev, convId, messages);
      saveConversations(next);
      return next;
    });
  }, [busy, convId, messages]);

  const submit = () => {
    if (!input.trim() || busy) return;

    const classification = classifyRequest(input);
    if (classification.path === "drafting") {
      // Not a research question — hand it to the drafting form instead of
      // running it through hybridSearch/chat, and carry the raw text over as
      // notes so the lawyer doesn't have to retype what they already wrote.
      setRoutedDraft({ kind: classification.kind, notes: input, key: Date.now() });
      setTab("draft");
      setInput("");
      if (taRef.current) taRef.current.style.height = "auto";
      return;
    }

    send(input, filters);
    setInput("");
    if (taRef.current) taRef.current.style.height = "auto";
  };

  const newChat = () => {
    reset();
    setConvId(crypto.randomUUID());
    setShowHistory(false);
  };

  const openConversation = (c: Conversation) => {
    stop();
    setMessages(c.messages);
    setConvId(c.id);
    setTab("chat");
    setShowHistory(false);
  };

  const deleteConversation = (id: string) => {
    setConversations((prev) => {
      const next = prev.filter((c) => c.id !== id);
      saveConversations(next);
      return next;
    });
    // Deleting the open conversation leaves the transcript up but detaches it,
    // so the next reply doesn't resurrect what was just deleted.
    if (id === convId) newChat();
  };

  const activeFilters = Object.values(filters).filter(Boolean).length;

  return (
    <div className="flex h-screen flex-col">
      <header className="flex shrink-0 flex-wrap items-center justify-between gap-y-2 border-b border-edge px-4 py-3">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-accent/30 bg-accent/10 text-accent">
            <Logo className="h-6 w-6" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="whitespace-nowrap text-sm font-semibold">المساعد القانوني الذكي</h1>
              <span className="whitespace-nowrap rounded border border-amber-700/50 bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-amber-300">
                نسخة تجريبية
              </span>
            </div>
            <p className="text-[11px] text-muted">يجيب من قاعدة البيانات القانونية فقط</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <UsageMeter refreshOn={busy} />
          <div className="flex rounded-lg border border-edge p-0.5">
            {(
              [
                ["chat", "محادثة"],
                ["case", "تحليل قضية"],
                ["draft", "صياغة"],
              ] as const
            ).map(([k, label]) => (
              <button
                key={k}
                onClick={() => {
                  setTab(k);
                  // A manual tab click is the lawyer choosing "صياغة" on
                  // purpose — the auto-routed banner should only ever appear
                  // after a redirect classifyRequest actually made.
                  if (k === "draft") setRoutedDraft(null);
                }}
                className={`whitespace-nowrap rounded-md px-3 py-1 text-xs ${tab === k ? "bg-panel text-white" : "text-muted"}`}
              >
                {label}
              </button>
            ))}
          </div>
          {tab === "chat" && (
            <>
              <button
                onClick={() => setShowHistory(true)}
                className={`btn-ghost whitespace-nowrap px-3 py-1 text-xs ${showHistory ? "text-accent" : ""}`}
              >
                السجل{conversations.length ? ` (${conversations.length})` : ""}
              </button>
              {messages.length > 0 && (
                <button onClick={newChat} className="btn-ghost whitespace-nowrap px-3 py-1 text-xs">
                  محادثة جديدة
                </button>
              )}
            </>
          )}
          <LogoutButton onLogout={onLogout} />
        </div>
      </header>

      {showHistory && (
        <HistoryDrawer
          conversations={conversations}
          activeId={convId}
          onClose={() => setShowHistory(false)}
          onOpen={openConversation}
          onDelete={deleteConversation}
          onNew={newChat}
        />
      )}

      {tab === "case" ? (
        <div className="flex-1 overflow-y-auto">
          <CaseUpload />
        </div>
      ) : tab === "draft" ? (
        <div className="flex-1 overflow-y-auto">
          <DraftAssistant
            key={routedDraft?.key ?? "manual"}
            initialKind={routedDraft?.kind}
            initialNotes={routedDraft?.notes}
          />
        </div>
      ) : (
        <>
          <div className="flex-1 overflow-y-auto">
            <div className="mx-auto max-w-3xl px-4 py-6">
              {messages.length === 0 ? (
                <Welcome onPick={(q) => send(q, filters)} />
              ) : (
                <div className="space-y-6">
                  {messages.map((m) =>
                    m.role === "user" ? (
                      <div key={m.id} className="flex justify-start">
                        <div className="max-w-[85%] rounded-2xl rounded-tr-sm bg-panel px-4 py-2.5 text-sm">
                          {m.content}
                        </div>
                      </div>
                    ) : (
                      <div key={m.id} className="space-y-3">
                        {m.pending && !m.content && <Thinking mode={m.mode} />}

                        {m.error ? (
                          <div className="rounded-lg border border-red-900/60 bg-red-950/40 px-4 py-3 text-sm text-red-300">
                            {m.error}
                          </div>
                        ) : m.mode === "general" ? (
                          /* An ungrounded answer is fenced, not footnoted. A lawyer
                             must be able to tell at a glance that nothing here is
                             citable — a small note under the text is read after the
                             answer has already been trusted. */
                          <GeneralAnswer message={m} />
                        ) : (
                          m.content && <AnswerText text={m.content} />
                        )}

                        {m.gapFill && <GapFillAnswer text={m.gapFill} redactedCount={m.gapFillRedactedCount} />}

                        {m.hybridAnalysis && (
                          <HybridAnalysis
                            text={m.hybridAnalysis}
                            verifiedCount={m.hybridAnalysisVerifiedCount}
                            redactedCount={m.hybridAnalysisRedactedCount}
                          />
                        )}

                        {m.sources && m.sources.length > 0 && (
                          <details className="mt-4">
                            <summary className="cursor-pointer text-xs font-medium text-muted hover:text-slate-300">
                              المصادر القانونية المستند إليها ({m.sources.length})
                            </summary>
                            <div className="mt-2 space-y-2">
                              {m.sources.map((s) => (
                                <SourceCard key={s.id} c={s} />
                              ))}
                            </div>
                          </details>
                        )}

                        {m.mode === "refused" && !m.error && (
                          <p className="text-xs text-muted">
                            لم يتم عرض مصادر لأن قاعدة البيانات لا تحتوي على سند كافٍ لهذا السؤال.
                          </p>
                        )}

                        {m.grounded && m.disclaimer && <p className="text-[11px] leading-5 text-muted">{m.disclaimer}</p>}
                      </div>
                    )
                  )}
                  <div ref={endRef} />
                </div>
              )}
            </div>
          </div>

          <div className="shrink-0 border-t border-edge bg-ink/95 px-4 py-3 backdrop-blur">
            <div className="mx-auto max-w-3xl">
              {showFilters && (
                <div className="mb-2 grid grid-cols-1 gap-2 sm:grid-cols-3">
                  <select
                    className="field"
                    value={filters.category ?? ""}
                    onChange={(e) => setFilters((f) => ({ ...f, category: e.target.value || undefined }))}
                  >
                    <option value="">كل التصنيفات</option>
                    {CATEGORIES.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>

                  <select
                    className="field"
                    value={filters.court ?? ""}
                    onChange={(e) => setFilters((f) => ({ ...f, court: e.target.value || undefined }))}
                  >
                    <option value="">كل المحاكم</option>
                    {COURTS.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>

                  <input
                    type="number"
                    className="field"
                    placeholder="السنة"
                    value={filters.year ?? ""}
                    onChange={(e) =>
                      setFilters((f) => ({ ...f, year: e.target.value ? Number(e.target.value) : undefined }))
                    }
                  />
                </div>
              )}

              <div className="flex items-end gap-2 rounded-2xl border border-edge bg-panel p-2">
                <button
                  onClick={() => setShowFilters((v) => !v)}
                  title="تصفية البحث"
                  className={`shrink-0 rounded-lg px-2.5 py-2 text-xs ${
                    activeFilters ? "bg-accent/15 text-accent" : "text-muted hover:text-slate-300"
                  }`}
                >
                  تصفية{activeFilters ? ` (${activeFilters})` : ""}
                </button>

                <textarea
                  ref={taRef}
                  rows={1}
                  value={input}
                  onChange={(e) => {
                    setInput(e.target.value);
                    // Grow with content, capped so a long question can't eat
                    // the transcript.
                    e.target.style.height = "auto";
                    e.target.style.height = `${Math.min(e.target.scrollHeight, 200)}px`;
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      submit();
                    }
                  }}
                  placeholder="اطرح سؤالك القانوني... (Shift+Enter لسطر جديد)"
                  className="max-h-[200px] flex-1 resize-none bg-transparent px-2 py-2 text-sm outline-none placeholder:text-muted"
                />

                {busy ? (
                  <button onClick={stop} className="btn-ghost shrink-0 px-3 py-2 text-xs">
                    إيقاف
                  </button>
                ) : (
                  <button onClick={submit} disabled={!input.trim()} className="btn-primary shrink-0 px-4 py-2">
                    إرسال
                  </button>
                )}
              </div>

              <p className="mt-2 text-center text-[11px] text-muted">
                الإجابات مبنية حصراً على المصادر المخزّنة ولا تُغني عن المراجعة المهنية للمحامي.
              </p>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function HistoryDrawer({
  conversations,
  activeId,
  onClose,
  onOpen,
  onDelete,
  onNew,
}: {
  conversations: Conversation[];
  activeId: string | null;
  onClose: () => void;
  onOpen: (c: Conversation) => void;
  onDelete: (id: string) => void;
  onNew: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex">
      <div className="flex h-full w-80 max-w-[85vw] flex-col border-l border-edge bg-ink shadow-2xl">
        <div className="flex shrink-0 items-center justify-between border-b border-edge px-4 py-3">
          <h2 className="text-sm font-semibold">سجل المحادثات</h2>
          <button onClick={onClose} className="btn-ghost px-2 py-1 text-xs">
            إغلاق
          </button>
        </div>

        <div className="shrink-0 border-b border-edge px-3 py-2">
          <button onClick={onNew} className="btn-ghost w-full px-3 py-1.5 text-xs">
            + محادثة جديدة
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-2">
          {conversations.length === 0 ? (
            <p className="px-2 py-8 text-center text-xs leading-6 text-muted">
              لا توجد محادثات محفوظة بعد. تُحفظ محادثاتك على هذا الجهاز وحده.
            </p>
          ) : (
            <ul className="space-y-1">
              {conversations.map((c) => (
                <li key={c.id}>
                  <div
                    className={`group flex items-start gap-2 rounded-lg border px-3 py-2 transition-colors ${
                      c.id === activeId ? "border-accent/40 bg-accent/5" : "border-transparent hover:bg-panel"
                    }`}
                  >
                    <button onClick={() => onOpen(c)} className="min-w-0 flex-1 text-right">
                      <p className="truncate text-xs text-slate-300">{c.title}</p>
                      <p className="mt-0.5 text-[10px] text-muted">
                        {formatWhen(c.updatedAt)} · {c.messages.length} رسالة
                      </p>
                    </button>
                    {/* Always visible, not hover-revealed: on a touch screen
                        there is no hover, and the row would have no way out. */}
                    <button
                      onClick={() => onDelete(c.id)}
                      title="حذف المحادثة"
                      className="shrink-0 rounded px-1.5 py-0.5 text-[10px] text-muted transition-colors hover:text-red-400"
                    >
                      حذف
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <button
        onClick={onClose}
        aria-label="إغلاق السجل"
        className="h-full flex-1 cursor-default bg-black/50 backdrop-blur-[1px]"
      />
    </div>
  );
}

function Welcome({ onPick }: { onPick: (q: string) => void }) {
  return (
    <div className="flex flex-col items-center pt-16 text-center">
      <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl border border-accent/30 bg-accent/10 text-accent">
        <Logo className="h-10 w-10" />
      </div>
      <h2 className="text-xl font-semibold">المساعد القانوني الذكي</h2>
      <p className="mt-2 max-w-md text-sm leading-7 text-muted">
        بحث وتحليل قانوني مبني حصراً على القوانين والقرارات القضائية المخزّنة في قاعدة البيانات. لا يعتمد النظام على
        معرفة عامة، وإذا لم يجد سنداً قانونياً فسيصرّح بذلك.
      </p>

      <div className="mt-8 grid w-full max-w-2xl grid-cols-1 gap-2 sm:grid-cols-2">
        {EXAMPLES.map((q) => (
          <button
            key={q}
            onClick={() => onPick(q)}
            className="card p-3 text-right text-sm text-slate-300 transition-colors hover:border-accent/40 hover:text-white"
          >
            {q}
          </button>
        ))}
      </div>
    </div>
  );
}

function Thinking({ mode }: { mode?: string }) {
  return (
    <div className="flex items-center gap-2 text-sm text-muted">
      <span className="flex gap-1">
        <span className="dot h-1.5 w-1.5 rounded-full bg-muted" />
        <span className="dot h-1.5 w-1.5 rounded-full bg-muted" style={{ animationDelay: "0.2s" }} />
        <span className="dot h-1.5 w-1.5 rounded-full bg-muted" style={{ animationDelay: "0.4s" }} />
      </span>
      {mode === "general" ? "لا يوجد سند في القاعدة — يُعدّ إجابة عامة..." : "يبحث في قاعدة البيانات القانونية..."}
    </div>
  );
}

/**
 * An ungrounded answer, fenced off from the grounded ones.
 *
 * Amber, bordered, labelled before the text rather than after it. The visual
 * separation carries a real distinction: nothing inside this box is backed by
 * a stored source, so nothing inside it can be cited. Rendering it like a
 * normal answer with a footnote would invite exactly the mistake the whole
 * system exists to prevent.
 */
function GeneralAnswer({ message }: { message: ChatMessageType }) {
  return (
    <div className="rounded-xl border border-amber-700/50 bg-amber-950/20">
      <div className="flex items-start gap-2 border-b border-amber-700/40 px-4 py-2.5">
        <span className="mt-0.5 shrink-0 rounded bg-amber-500/20 px-1.5 py-0.5 text-[10px] font-semibold text-amber-300">
          إجابة عامة
        </span>
        <p className="text-[11px] leading-5 text-amber-200/90">
          {message.disclaimer ?? "غير مستندة إلى قاعدة البيانات القانونية."}
        </p>
      </div>

      <div className="px-4 py-3">
        <AnswerText text={message.content} />
      </div>

      {message.redactedCount ? (
        <p className="border-t border-amber-700/30 px-4 py-2 text-[11px] leading-5 text-amber-200/70">
          حُجبت {message.redactedCount} إشارة رقمية (رقم مادة أو قرار) من هذه الإجابة لأنها غير مستندة إلى مصدر مخزّن.
          لأرقام دقيقة، ارفع القانون أو القرار إلى قاعدة البيانات.
        </p>
      ) : null}
    </div>
  );
}

/**
 * A general-knowledge supplement for the part a grounded answer couldn't
 * cover — smaller and secondary next to `GeneralAnswer`, which fences a
 * *whole* ungrounded answer. Here most of the message above this box is real,
 * cited content; this box is the one part that isn't, so it stays visually
 * distinct without dominating the message the way a full-width warning would.
 */
function GapFillAnswer({ text, redactedCount }: { text: string; redactedCount?: number }) {
  return (
    <div className="rounded-lg border border-amber-700/40 bg-amber-950/10">
      <div className="flex items-start gap-2 border-b border-amber-700/30 px-3 py-2">
        <span className="mt-0.5 shrink-0 rounded bg-amber-500/20 px-1.5 py-0.5 text-[10px] font-semibold text-amber-300">
          تكملة عامة
        </span>
        <p className="text-[11px] leading-5 text-amber-200/80">
          غير مستندة إلى قاعدة البيانات القانونية، ولا يجوز الاستشهاد بها أمام المحكمة.
        </p>
      </div>
      <div className="px-3 py-2.5">
        <AnswerText text={text} />
      </div>
      {redactedCount ? (
        <p className="border-t border-amber-700/20 px-3 py-1.5 text-[10px] leading-5 text-amber-200/60">
          حُجبت {redactedCount} إشارة رقمية من هذا الجزء لأنها غير مستندة إلى مصدر مخزّن.
        </p>
      ) : null}
    </div>
  );
}

/**
 * Type-2 hybrid supplement: sources existed but overall retrieval confidence
 * was low. Blue rather than amber — deliberately, because unlike GapFillAnswer
 * and GeneralAnswer this block is NOT blindly redacted. Every citation-shaped
 * span in it was checked against the database (citation-verify.ts) before it
 * arrived here, so it may legitimately carry a real, verified citation. The
 * distinct color is the visual signal for that distinction.
 */
function HybridAnalysis({ text, verifiedCount, redactedCount }: { text: string; verifiedCount?: number; redactedCount?: number }) {
  return (
    <div className="rounded-lg border border-sky-800/40 bg-sky-950/10">
      <div className="flex items-start gap-2 border-b border-sky-800/30 px-3 py-2">
        <span className="mt-0.5 shrink-0 rounded bg-sky-500/20 px-1.5 py-0.5 text-[10px] font-semibold text-sky-300">
          تحليل تكميلي (GPT)
        </span>
        <p className="text-[11px] leading-5 text-sky-200/80">
          تحليل قانوني عام يكمّل الإجابة أعلاه، وليس من قاعدة البيانات مباشرة — أي رقم مادة أو قانون أو قرار ورد فيه
          جرى التحقق منه آلياً مقابل قاعدة البيانات.
        </p>
      </div>
      <div className="px-3 py-2.5">
        <AnswerText text={text} />
      </div>
      {verifiedCount || redactedCount ? (
        <p className="border-t border-sky-800/20 px-3 py-1.5 text-[10px] leading-5 text-sky-200/60">
          {verifiedCount ? `${verifiedCount} استشهاد تم التحقق منه مقابل قاعدة البيانات` : null}
          {verifiedCount && redactedCount ? " · " : null}
          {redactedCount ? `حُجبت ${redactedCount} إشارة رقمية لم تُوجد في قاعدة البيانات` : null}
        </p>
      ) : null}
    </div>
  );
}
