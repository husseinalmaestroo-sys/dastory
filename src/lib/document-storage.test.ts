import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdir, readFile, rm, writeFile } from 'fs/promises'
import { join } from 'path'
import { DocumentPathError, deleteDocumentFile, readDocumentFile, resolveDocumentPath, writeDocumentFile } from './document-storage'

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
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('refusing to resolve out-of-root path'))

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

describe('resolveDocumentPath', () => {
  it('resolves a normal relative url under the storage root', () => {
    const resolved = resolveDocumentPath('case-documents/office1/user1/file.pdf')
    expect(resolved).toContain(join('storage', 'case-documents', 'office1', 'user1', 'file.pdf'))
  })

  it('throws DocumentPathError for a traversal attempt instead of silently resolving it', () => {
    expect(() => resolveDocumentPath('../../../../etc/passwd')).toThrow(DocumentPathError)
  })
})

describe('writeDocumentFile / readDocumentFile', () => {
  afterEach(async () => {
    await rm(join(process.cwd(), 'storage', 'case-documents', '__write_test_office__'), { recursive: true, force: true })
  })

  it('writes real bytes to disk and reads back the exact same bytes', async () => {
    const bytes = Buffer.from('hello real file content, not a placeholder')
    const url = await writeDocumentFile('__write_test_office__', '__write_test_user__', 'my file.pdf', 'PDF', bytes)

    expect(url).toContain('__write_test_office__')
    expect(url).toContain('__write_test_user__')

    const readBack = await readDocumentFile(url)
    expect(readBack.equals(bytes)).toBe(true)
  })

  it('a traversal-shaped original filename cannot escape the office/user directory', async () => {
    // The "/" in "../.." gets stripped along with every other unsafe
    // character, so a literal ".." can remain inside the single sanitized
    // filename component (e.g. "..__..evil.pdf") without being a real
    // traversal — what actually matters, verified here: the url still has
    // exactly the 4 expected path segments (no extra "/" smuggled in via
    // the original filename), and the file genuinely lands inside, and
    // only inside, this upload's own directory.
    const bytes = Buffer.from('x')
    const url = await writeDocumentFile('__write_test_office__', '__write_test_user__', '../../evil<script>.pdf', 'PDF', bytes)
    const segments = url.split('/')
    expect(segments).toHaveLength(4)
    expect(segments.slice(0, 3)).toEqual(['case-documents', '__write_test_office__', '__write_test_user__'])
    expect(url).not.toContain('<')
    // And the file is genuinely readable back from exactly that location.
    await expect(readDocumentFile(url)).resolves.toEqual(bytes)
  })

  it('two uploads with the same original filename never collide on disk', async () => {
    const a = await writeDocumentFile('__write_test_office__', '__write_test_user__', 'same-name.pdf', 'PDF', Buffer.from('A'))
    const b = await writeDocumentFile('__write_test_office__', '__write_test_user__', 'same-name.pdf', 'PDF', Buffer.from('B'))
    expect(a).not.toBe(b)
    expect((await readDocumentFile(a)).toString()).toBe('A')
    expect((await readDocumentFile(b)).toString()).toBe('B')
  })
})
