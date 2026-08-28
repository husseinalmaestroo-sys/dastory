import "server-only";
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { randomUUID, createHash } from "node:crypto";
import { env } from "./env";

export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024; // 20MB

export type SavedFile = { path: string; name: string; size: number; hash: string };

/**
 * Persists an uploaded PDF under STORAGE_DIR/<bucket>/<yyyy-mm>/.
 *
 * The stored filename is a UUID, never the client's. A browser-supplied name
 * can contain "../" or a null byte, and joining it onto a path is a directory
 * traversal write. The original is kept in the DB column for display only.
 */
export async function savePdf(file: File, bucket: "sources" | "cases"): Promise<SavedFile> {
  if (file.size === 0) throw new Error("الملف فارغ.");
  if (file.size > MAX_UPLOAD_BYTES) {
    throw new Error(`حجم الملف يتجاوز الحد المسموح (${MAX_UPLOAD_BYTES / 1024 / 1024}MB).`);
  }

  const buffer = Buffer.from(await file.arrayBuffer());

  // Trust the bytes, not the Content-Type header — that is client-controlled.
  if (buffer.subarray(0, 5).toString("latin1") !== "%PDF-") {
    throw new Error("الملف ليس بصيغة PDF صالحة.");
  }

  const month = new Date().toISOString().slice(0, 7);
  const dir = resolve(process.cwd(), env.storageDir, bucket, month);
  await mkdir(dir, { recursive: true });

  const path = join(dir, `${randomUUID()}.pdf`);
  await writeFile(path, buffer);

  return {
    path,
    name: sanitizeName(file.name),
    size: file.size,
    // Content hash, so the same decision uploaded twice under different
    // filenames is caught before it is embedded twice.
    hash: createHash("sha256").update(buffer).digest("hex"),
  };
}

function sanitizeName(name: string): string {
  return name.replace(/[\/\\]/g, "_").replace(/\0/g, "").slice(0, 200) || "document.pdf";
}
