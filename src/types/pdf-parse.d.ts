/**
 * pdf-parse ships no types for its lib entrypoint, and we import that path
 * directly rather than the package root — the root runs a debug block that
 * reads a test PDF off disk at import time and throws when bundled.
 */
declare module "pdf-parse/lib/pdf-parse.js" {
  type PdfParseResult = {
    text: string;
    numpages: number;
    numrender: number;
    info: Record<string, unknown>;
    metadata: unknown;
    version: string;
  };
  function pdfParse(buffer: Buffer | Uint8Array): Promise<PdfParseResult>;
  export default pdfParse;
}
