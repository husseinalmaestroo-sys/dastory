import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdir, readFile, rm, writeFile } from 'fs/promises'
import { join } from 'path'
import { deleteDocumentFile } from './document-storage'

const TEST_DIR = join(process.cwd(), 'storage', 'case-documents', '__test_office__', '__test_user__')

async function writeTestFile(name: string) {
  await mkdir(TEST_DIR, { recursive: true })
  const path = join(TEST_DIR, name)
  await writeFile(path, 'test content')
  return path
}

describe('deleteDocumentFile', () => {
  afterEach(async () => {
    await rm(join(process.cwd(), 'storage', 'case-documents', '__test_office__'), { recursive: true, force: true })
  })

  it('deletes a file that exists under the allowed storage root', async () => {
    await writeTestFile('doc-a.pdf')
    const url = 'case-documents/__test_office__/__test_user__/doc-a.pdf'

    await deleteDocumentFile(url)

    await expect(readFile(join(process.cwd(), 'storage', url))).rejects.toThrow()
  })

  it('does not throw when the file is already missing', async () => {
    const url = 'case-documents/__test_office__/__test_user__/never-existed.pdf'
    await expect(deleteDocumentFile(url)).resolves.toBeUndefined()
  })

  it('does nothing for a null/undefined url', async () => {
    await expect(deleteDocumentFile(null)).resolves.toBeUndefined()
    await expect(deleteDocumentFile(undefined)).resolves.toBeUndefined()
  })

  it('does nothing for a legacy pre-migration /uploads/ path', async () => {
    await expect(deleteDocumentFile('/uploads/some-old-file.pdf')).resolves.toBeUndefined()
  })

  it('refuses a path-traversal attempt and never touches anything outside the storage root', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    // If this were joined naively, it would resolve outside storage/case-documents entirely.
    const maliciousUrl = '../../../../etc/passwd'

    await expect(deleteDocumentFile(maliciousUrl)).resolves.toBeUndefined()
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('refusing to delete out-of-root path'))

    consoleSpy.mockRestore()
  })

  it('refuses a traversal attempt that tries to climb out via encoded-looking segments', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    await deleteDocumentFile('case-documents/../../../../windows/system32/config')
    expect(consoleSpy).toHaveBeenCalled()
    consoleSpy.mockRestore()
  })

  it('leaves a sibling file untouched when deleting one file in the same directory', async () => {
    await writeTestFile('keep-me.pdf')
    await writeTestFile('delete-me.pdf')

    await deleteDocumentFile('case-documents/__test_office__/__test_user__/delete-me.pdf')

    await expect(readFile(join(TEST_DIR, 'keep-me.pdf'), 'utf8')).resolves.toBe('test content')
    await expect(readFile(join(TEST_DIR, 'delete-me.pdf'))).rejects.toThrow()
  })
})
