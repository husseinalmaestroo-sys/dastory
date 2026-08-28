"use client";

import { useEffect, useRef } from "react";
import type { DraftBlock } from "@/lib/drafting/parse";

/**
 * Kept as a plain local literal union, not imported from ai/prompts.ts's
 * RefineAction — that module starts with `import "server-only"`, and this is
 * a "use client" component. Structurally identical to the server-side type;
 * DraftAssistant.tsx's fetch body is what actually has to match the API.
 */
type RefineAction = "regenerate" | "improve" | "shorten" | "expand";

const REFINE_LABELS: Record<RefineAction, string> = {
  regenerate: "إعادة الصياغة",
  improve: "تحسين الصياغة",
  shorten: "تقصير",
  expand: "توسيع",
};

/**
 * Renders a generated draft as an editable court document, styled like paper
 * rather than like the app's dark chat UI — the lawyer is looking at the thing
 * they're about to print or paste into a filing, not at a chat bubble.
 *
 * Editing works at the block level (see draftToBlocks): headings and the
 * signature line are single-line fields, and the prose under each heading is
 * one auto-growing textarea. That keeps the marker structure the exporter
 * depends on intact no matter what the lawyer types.
 *
 * `onRefine`/`onMoveSection` are optional so this component still works as a
 * plain manual editor with neither wired up; DraftAssistant.tsx is the only
 * caller today and wires both.
 */
export function DraftPaper({
  blocks,
  onChange,
  onRefine,
  refiningId = null,
  refineErrors = {},
  onMoveSection,
}: {
  blocks: DraftBlock[];
  onChange: (blocks: DraftBlock[]) => void;
  /** Ask the model to regenerate/improve/shorten/expand one body block. */
  onRefine?: (blockId: string, action: RefineAction) => void;
  /** Which block a refine request is currently in flight for, if any. */
  refiningId?: string | null;
  /** Per-block error message from the most recent failed refine attempt. */
  refineErrors?: Record<string, string>;
  /** Move a whole section (its heading + body) up or down past its neighbour. */
  onMoveSection?: (headingBlockId: string, direction: "up" | "down") => void;
}) {
  const setBlock = (id: string, text: string) => {
    onChange(blocks.map((b) => (b.id === id ? { ...b, text } : b)));
  };

  return (
    <div className="rounded-xl bg-[#f8f6f0] p-8 text-[#1a1a1a] shadow-lg sm:p-12" dir="rtl">
      <div className="mx-auto max-w-[680px] space-y-1">
        {blocks.map((b) => {
          switch (b.type) {
            case "header":
              return <HeaderField key={b.id} block={b} onChange={(t) => setBlock(b.id, t)} />;
            case "heading":
              return (
                <HeadingField
                  key={b.id}
                  block={b}
                  onChange={(t) => setBlock(b.id, t)}
                  onMove={onMoveSection ? (dir) => onMoveSection(b.id, dir) : undefined}
                />
              );
            case "body":
              return (
                <BodyField
                  key={b.id}
                  block={b}
                  onChange={(t) => setBlock(b.id, t)}
                  onRefine={onRefine ? (action) => onRefine(b.id, action) : undefined}
                  refining={refiningId === b.id}
                  error={refineErrors[b.id]}
                />
              );
            case "signature":
              return <SignatureField key={b.id} block={b} onChange={(t) => setBlock(b.id, t)} />;
            default:
              return null;
          }
        })}
      </div>
    </div>
  );
}

const fieldBase =
  "w-full resize-none border-0 border-b border-transparent bg-transparent px-1 py-0.5 leading-8 outline-none transition-colors focus:border-black/20 focus:bg-black/[0.03]";

// Light, paper-toned — deliberately not .btn-ghost, which is styled for the
// app's dark chat theme and would look wrong on this component's #f8f6f0
// background (same reasoning fieldBase above already applies to text inputs).
const paperBtn =
  "rounded border border-black/10 bg-black/[0.02] px-2 py-0.5 text-[10px] text-black/60 transition-colors hover:border-black/20 hover:bg-black/[0.06] hover:text-black/80 disabled:cursor-not-allowed disabled:opacity-40";

function HeaderField({ block, onChange }: { block: DraftBlock; onChange: (t: string) => void }) {
  return (
    <input
      value={block.text}
      onChange={(e) => onChange(e.target.value)}
      className={`${fieldBase} text-center text-lg font-bold`}
    />
  );
}

function HeadingField({
  block,
  onChange,
  onMove,
}: {
  block: DraftBlock;
  onChange: (t: string) => void;
  onMove?: (direction: "up" | "down") => void;
}) {
  return (
    <div className="pt-5">
      <div className="flex items-center gap-1.5">
        <input
          value={block.text}
          onChange={(e) => onChange(e.target.value)}
          className={`${fieldBase} border-b-2 border-b-black/15 text-[15px] font-bold`}
        />
        {onMove && (
          <div className="flex shrink-0 gap-1 print:hidden">
            <button type="button" onClick={() => onMove("up")} title="نقل القسم لأعلى" className={paperBtn}>
              ↑
            </button>
            <button type="button" onClick={() => onMove("down")} title="نقل القسم لأسفل" className={paperBtn}>
              ↓
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function SignatureField({ block, onChange }: { block: DraftBlock; onChange: (t: string) => void }) {
  return (
    <div className="pt-10 text-right">
      <input
        value={block.text}
        onChange={(e) => onChange(e.target.value)}
        className={`${fieldBase} inline-block w-auto min-w-[220px] text-[15px] font-semibold`}
      />
    </div>
  );
}

function BodyField({
  block,
  onChange,
  onRefine,
  refining,
  error,
}: {
  block: DraftBlock;
  onChange: (t: string) => void;
  onRefine?: (action: RefineAction) => void;
  refining?: boolean;
  error?: string;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);

  const autoGrow = (el: HTMLTextAreaElement) => {
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  };

  useEffect(() => {
    if (ref.current) autoGrow(ref.current);
  }, [block.text]);

  return (
    <div>
      <textarea
        ref={ref}
        rows={1}
        value={block.text}
        onChange={(e) => {
          onChange(e.target.value);
          autoGrow(e.target);
        }}
        className={`${fieldBase} overflow-hidden text-[14px]`}
      />
      {onRefine && (
        <div className="mb-2 flex flex-wrap items-center gap-1.5 print:hidden">
          {(Object.keys(REFINE_LABELS) as RefineAction[]).map((action) => (
            <button
              key={action}
              type="button"
              onClick={() => onRefine(action)}
              disabled={refining}
              className={paperBtn}
            >
              {REFINE_LABELS[action]}
            </button>
          ))}
          {refining && <span className="text-[10px] text-black/50">جارٍ التعديل...</span>}
          {error && !refining && <span className="text-[10px] text-red-700/80">{error}</span>}
        </div>
      )}
    </div>
  );
}
