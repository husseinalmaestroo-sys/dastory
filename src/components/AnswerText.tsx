"use client";

import { Fragment } from "react";

/**
 * A [فجوة: ...] left in the visible text means the server-side gap-fill call
 * (see GAP_MARKER_RE in ai/prompts.ts) never ran or failed — the marker is
 * meta-instruction for the pipeline, not something a lawyer should read.
 * Duplicated here rather than imported: prompts.ts is `server-only`, and this
 * component isn't.
 */
const GAP_MARKER_RE = /\s*\[فجوة:[^\]]+\]/g;

/**
 * Renders the answer, turning [1] refs into badges and **bold** spans into
 * <strong>. The prompts tell the model to write plain prose, but that's
 * guidance, not enforcement — it emits Markdown emphasis often enough that a
 * lawyer would otherwise read raw asterisks in a legal document. Parsing it
 * defensively here is cheaper than trusting compliance.
 *
 * Built by splitting the string, not by injecting HTML: the text is model
 * output shaped by user input, so dangerouslySetInnerHTML here would be an
 * XSS sink one clever prompt away from firing.
 */
export function AnswerText({ text }: { text: string }) {
  const parts = text.replace(GAP_MARKER_RE, "").split(/(\[\d{1,2}\]|\*\*[^*\n]+\*\*)/g);

  return (
    <div className="answer">
      {parts.map((part, i) => {
        const cite = part.match(/^\[(\d{1,2})\]$/);
        if (cite) {
          return (
            <sup key={i} className="cite">
              {cite[1]}
            </sup>
          );
        }

        const bold = part.match(/^\*\*([^*\n]+)\*\*$/);
        if (bold) {
          return <strong key={i}>{bold[1]}</strong>;
        }

        return <Fragment key={i}>{part}</Fragment>;
      })}
    </div>
  );
}
