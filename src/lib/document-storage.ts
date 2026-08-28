import { mkdir, readFile, unlink, writeFile } from 'fs/promises'
import { isAbsolute, join, normalize, relative } from 'path'
import { randomUUID } from 'crypto'

const ALLOWED_ROOT = normalize(join(process.cwd(), 'storage', 'case-documents'))

function isInside(root: string, target: string) {
  const rel = relative(root, target)
  return rel === '' || (!!rel && !rel.startsWith('..') && !isAbsolute(rel))
}

export class DocumentPathError extends Error {}

/** Resolves a stored document's relative URL to an absolute path, refusing anything that would escape the storage root. */
export function resolveDocumentPath(url: string): string {
  const absolutePath = normalize(join(process.cwd(), 'storage', url))
  if (!isInside(ALLOWED_ROOT, absolutePath)) {
    throw new DocumentPathError(`refusing to resolve out-of-root path for url "${url}"`)
  }
  return absolutePath
}

/** Reads a stored document's bytes off disk, tenant-scoping is the caller's responsibility (via the Document row lookup that produced `url`). */
export async function readDocumentFile(url: string): Promise<Buffer> {
  return readFile(resolveDocumentPath(url))
}

/**
 * Writes a new file under an office/user's upload directory and returns the
 * relative URL to store on the Document row. Shared by the upload route and
 * the e-signature route so there is exactly one implementation of "how a
 * file gets safely written to disk," not two that could drift.
 */
export async function writeDocumentFile(
  officeId: string,
  userId: string,
  originalName: string,
  ext: string,
  bytes: Buffer
): Promise<string> {
  const uploadDir = join(process.cwd(), 'storage', 'case-documents', officeId, userId)
  await mkdir(uploadDir, { recursive: true })

  const safeName = originalName
    .replace(/[^\w.؀-ۿ-]/g, '_')
    .replace(/_+/g, '_')
    .slice(0, 120)
  const uniqueName = `${Date.now()}-${randomUUID()}-${safeName || `document.${ext.toLowerCase()}`}`
  await writeFile(join(uploadDir, uniqueName), bytes)
  return ['case-documents', officeId, userId, uniqueName].join('/')
}

/**
 * Deletes the on-disk file for a stored document URL (the relative path
 * under storage/case-documents/... written by the upload route). Best
 * effort: a missing file or an old pre-migration /uploads/ path is not an
 * error — this exists to stop files being orphaned on disk when their
 * Document row is deleted, not to guarantee every historical path is
 * cleaned up.
 */
export async function deleteDocumentFile(url: string | null | undefined): Promise<void> {
  if (!url || url.startsWith('/uploads/')) return

  let absolutePath: string
  try {
    absolutePath = resolveDocumentPath(url)
  } catch (err) {
    console.error((err as Error).message)
    return
  }

  try {
    await unlink(absolutePath)
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      console.error(`deleteDocumentFile: failed to delete "${absolutePath}"`, err)
    }
  }
}
