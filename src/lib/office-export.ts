import { ZipArchive } from 'archiver'
import { prisma } from '@/lib/prisma'
import { readDocumentFile } from '@/lib/document-storage'

// Embedding document files is capped so one office with a huge corpus can't
// exhaust the container's memory mid-export. Past the cap, files are still
// listed in documents.json but not bundled, and README.txt / the entry note
// says why.
const MAX_EMBEDDED_BYTES = 200 * 1024 * 1024

export interface OfficeExport {
  filename: string
  buffer: Buffer
}

/**
 * A point-in-time copy of everything one office owns: the office record, its
 * users (never password hashes or 2FA secrets), and every client, case,
 * court session, invoice and document — the JSON records plus the actual
 * uploaded files. Scoped by `officeId` only: this is the office-wide export,
 * so the caller must already have gated it to an OFFICE_MANAGER.
 *
 * Not re-importable and deletes nothing — it exists so an office can walk
 * away with its data (privacy policy §6, PDPL).
 */
export async function buildOfficeExport(officeId: string): Promise<OfficeExport> {
  const [office, users, clients, cases, sessions, invoices, documents] = await Promise.all([
    prisma.office.findUnique({ where: { id: officeId } }),
    prisma.user.findMany({
      where: { officeId },
      // Explicit select — never leak `password` or `twoFactorSecret`.
      select: {
        id: true, email: true, name: true, role: true, phone: true, barNumber: true,
        active: true, emailVerified: true, twoFactorEnabled: true, createdAt: true, updatedAt: true,
      },
      orderBy: { createdAt: 'asc' },
    }),
    prisma.client.findMany({ where: { officeId }, orderBy: { createdAt: 'asc' } }),
    prisma.case.findMany({ where: { officeId }, orderBy: { createdAt: 'asc' } }),
    prisma.session.findMany({ where: { officeId }, orderBy: { createdAt: 'asc' } }),
    prisma.invoice.findMany({ where: { officeId }, orderBy: { createdAt: 'asc' } }),
    prisma.document.findMany({ where: { officeId }, orderBy: { createdAt: 'asc' } }),
  ])

  // archiver v8 exposes the format classes directly (no `archiver('zip')`
  // factory any more).
  const archive = new ZipArchive({ zlib: { level: 9 } })
  const chunks: Buffer[] = []
  archive.on('data', (c: Buffer) => chunks.push(c))
  archive.on('warning', (err) => console.warn('[office-export] archiver warning', err.message))

  const json = (v: unknown) => JSON.stringify(v, null, 2)
  archive.append(json(office), { name: 'office.json' })
  archive.append(json(users), { name: 'team.json' })
  archive.append(json(clients), { name: 'clients.json' })
  archive.append(json(cases), { name: 'cases.json' })
  archive.append(json(sessions), { name: 'sessions.json' })
  archive.append(json(invoices), { name: 'invoices.json' })

  let embeddedBytes = 0
  let embeddedCount = 0
  let skippedCount = 0
  const manifest: Record<string, unknown>[] = []
  for (const doc of documents) {
    const entry: Record<string, unknown> = {
      id: doc.id, name: doc.name, type: doc.type, size: doc.size,
      caseId: doc.caseId, ownerId: doc.ownerId, createdAt: doc.createdAt, file: null,
    }
    if (doc.url && !doc.url.startsWith('/uploads/')) {
      try {
        const bytes = await readDocumentFile(doc.url)
        if (embeddedBytes + bytes.length <= MAX_EMBEDDED_BYTES) {
          const safe = `${doc.id}-${doc.name}`.replace(/[^\w.؀-ۿ-]/g, '_').slice(0, 150)
          archive.append(bytes, { name: `documents/${safe}` })
          entry.file = `documents/${safe}`
          embeddedBytes += bytes.length
          embeddedCount++
        } else {
          entry.note = 'not embedded — export size cap reached'
          skippedCount++
        }
      } catch {
        entry.note = 'file not found on disk'
        skippedCount++
      }
    } else if (doc.url) {
      entry.note = 'legacy storage path — file not bundled'
    } else {
      entry.note = 'no file attached'
    }
    manifest.push(entry)
  }
  archive.append(json(manifest), { name: 'documents.json' })

  archive.append(
    [
      'Dostoori — office data export',
      `Office:     ${office?.name ?? officeId}`,
      `Generated:  ${new Date().toISOString()}`,
      '',
      'Contents',
      '  office.json     the office record',
      '  team.json       users (no password hashes, no 2FA secrets)',
      `  clients.json    ${clients.length} clients`,
      `  cases.json      ${cases.length} cases`,
      `  sessions.json   ${sessions.length} court sessions`,
      `  invoices.json   ${invoices.length} invoices`,
      `  documents.json  manifest of ${documents.length} documents`,
      `  documents/      ${embeddedCount} document file(s)` +
        (skippedCount ? ` — ${skippedCount} not bundled (see notes in documents.json)` : ''),
      '',
      'Timestamps are ISO 8601 UTC. This is a point-in-time copy: it is not',
      're-importable and does not delete anything on our side.',
      '',
    ].join('\n'),
    { name: 'README.txt' },
  )

  // Resolves once every chunk has been emitted to our `data` listener.
  await archive.finalize()

  const stamp = new Date().toISOString().slice(0, 10)
  return { filename: `dostoori-export-${stamp}.zip`, buffer: Buffer.concat(chunks) }
}
