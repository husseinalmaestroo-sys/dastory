import "server-only";
import {
  AlignmentType,
  Document,
  Packer,
  Paragraph,
  TextRun,
  convertInchesToTwip,
} from "docx";
import { parseDraft, splitCitations, type DocLine } from "./parse";

/**
 * Turns the marker-formatted draft (see FORMAT_RULES in ai/prompts.ts) into a
 * downloadable .docx. Kept separate from parse.ts because this file pulls in
 * the docx package, which the on-screen paper component has no need for.
 */

const ARABIC_FONT = "Calibri";

function runsFor(text: string): TextRun[] {
  return splitCitations(text).map(
    (part) =>
      new TextRun({
        text: part.cite ? `[${part.text}]` : part.text,
        font: ARABIC_FONT,
        size: 24, // 12pt
        superScript: Boolean(part.cite),
        rightToLeft: true,
      })
  );
}

function paragraphFor(line: DocLine): Paragraph {
  const shared = {
    bidirectional: true,
    alignment: AlignmentType.RIGHT,
  } as const;

  switch (line.type) {
    case "header":
      return new Paragraph({
        ...shared,
        alignment: AlignmentType.CENTER,
        spacing: { after: 120 },
        children: [
          new TextRun({ text: line.text, font: ARABIC_FONT, size: 30, bold: true, rightToLeft: true }),
        ],
      });
    case "heading":
      return new Paragraph({
        ...shared,
        spacing: { before: 240, after: 120 },
        border: { bottom: { color: "auto", space: 1, style: "single", size: 4 } },
        children: [new TextRun({ text: line.text, font: ARABIC_FONT, size: 26, bold: true, rightToLeft: true })],
      });
    case "signature":
      return new Paragraph({
        ...shared,
        spacing: { before: 480 },
        children: [new TextRun({ text: line.text, font: ARABIC_FONT, size: 24, bold: true, rightToLeft: true })],
      });
    case "blank":
      return new Paragraph({ ...shared, children: [] });
    default:
      return new Paragraph({
        ...shared,
        spacing: { after: 100 },
        children: runsFor(line.text),
      });
  }
}

export async function draftToDocx(draft: string): Promise<Buffer> {
  const lines = parseDraft(draft);

  const doc = new Document({
    sections: [
      {
        properties: {
          page: {
            margin: {
              top: convertInchesToTwip(1),
              bottom: convertInchesToTwip(1),
              left: convertInchesToTwip(1),
              right: convertInchesToTwip(1),
            },
          },
        },
        children: lines.map(paragraphFor),
      },
    ],
  });

  return Packer.toBuffer(doc);
}
