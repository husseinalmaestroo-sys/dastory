import { unlink } from 'fs/promises'
import { isAbsolute, join, normalize, relative } from 'path'

const ALLOWED_ROOT = normalize(join(process.cwd(), 'storage', 'case-documents'))

function isInside(root: string, target: string) {
  const rel = relative(root, target)
  return rel === '' || (!!rel && !rel.startsWith('..') && !isAbsolute(rel))
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

  const absolutePath = normalize(join(process.cwd(), 'storage', url))
  if (!isInside(ALLOWED_ROOT, absolutePath)) {
    console.error(`deleteDocumentFile: refusing to delete out-of-root path for url "${url}"`)
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
