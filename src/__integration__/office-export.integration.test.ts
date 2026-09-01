import { afterEach, describe, expect, it } from 'vitest'
import AdmZip from 'adm-zip'
import { Role } from '@prisma/client'
import { GET as exportOffice } from '@/app/api/office/export/route'
import { cleanupOffice, createColleague, createTestOfficeUser, testRequest } from './helpers'
import { prisma } from '@/lib/prisma'

const createdOffices: string[] = []
afterEach(async () => {
  await Promise.all(createdOffices.splice(0).map(cleanupOffice))
})

/** Seeds one office with >=2 rows in every exported entity, incl. documents with real files on disk. */
async function seedOffice(label: string) {
  const manager = await createTestOfficeUser({ role: Role.OFFICE_MANAGER })
  createdOffices.push(manager.officeId)
  const { officeId } = manager
  const { writeDocumentFile } = await import('@/lib/document-storage')

  const clients = await Promise.all([
    prisma.client.create({ data: { name: `${label} Client One`, officeId, ownerId: manager.id } }),
    prisma.client.create({ data: { name: `${label} Client Two`, officeId, ownerId: manager.id } }),
  ])
  const cases = await Promise.all([
    prisma.case.create({ data: { number: `${label}-C1`, title: `${label} Case One`, type: 'مدني', clientId: clients[0].id, ownerId: manager.id, officeId } }),
    prisma.case.create({ data: { number: `${label}-C2`, title: `${label} Case Two`, type: 'تجاري', clientId: clients[1].id, ownerId: manager.id, officeId } }),
  ])
  await Promise.all([
    prisma.session.create({ data: { date: new Date('2026-10-01'), time: '09:00', court: `${label} Court`, caseId: cases[0].id, officeId } }),
    prisma.session.create({ data: { date: new Date('2026-10-02'), time: '10:30', court: `${label} Court`, caseId: cases[1].id, officeId } }),
  ])
  await Promise.all([
    prisma.invoice.create({ data: { number: `${label}-INV1`, amount: 500, clientId: clients[0].id, caseId: cases[0].id, officeId } }),
    prisma.invoice.create({ data: { number: `${label}-INV2`, amount: 750, clientId: clients[1].id, officeId } }),
  ])
  const docBytes = [Buffer.from(`${label} document one body`), Buffer.from(`${label} document two body`)]
  const urls = await Promise.all([
    writeDocumentFile(officeId, manager.id, `${label}-doc1.txt`, 'TXT', docBytes[0]),
    writeDocumentFile(officeId, manager.id, `${label}-doc2.txt`, 'TXT', docBytes[1]),
  ])
  await Promise.all([
    prisma.document.create({ data: { name: `${label}-doc1.txt`, type: 'TXT', officeId, ownerId: manager.id, url: urls[0] } }),
    prisma.document.create({ data: { name: `${label}-doc2.txt`, type: 'TXT', officeId, ownerId: manager.id, url: urls[1] } }),
  ])

  return { manager, officeId, docBytes }
}

function openZip(buf: Buffer) {
  const zip = new AdmZip(buf)
  const names = zip.getEntries().map((e) => e.entryName)
  const readJsonFile = (name: string) => JSON.parse(zip.readAsText(name))
  return { zip, names, readJsonFile }
}

describe('office data export — completeness, tenant isolation, role gate', () => {
  it('requires authentication', async () => {
    const res = await exportOffice(testRequest('/api/office/export'))
    expect(res.status).toBe(401)
  })

  it('a LAWYER in the office cannot run the office-wide export (403)', async () => {
    const manager = await createTestOfficeUser({ role: Role.OFFICE_MANAGER })
    createdOffices.push(manager.officeId)
    const lawyer = await createColleague(manager.officeId, { role: Role.LAWYER })

    const res = await exportOffice(testRequest('/api/office/export', { user: lawyer }))
    expect(res.status).toBe(403)
  })

  it('bundles every row and every document file for the office, and nothing from another office', async () => {
    const a = await seedOffice('AA')
    const b = await seedOffice('BB')

    const res = await exportOffice(testRequest('/api/office/export', { user: a.manager }))
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('application/zip')
    expect(res.headers.get('content-disposition')).toContain('dostoori-export-')

    const buf = Buffer.from(await res.arrayBuffer())
    const { zip, names, readJsonFile } = openZip(buf)

    // structure
    for (const f of ['office.json', 'team.json', 'clients.json', 'cases.json', 'sessions.json', 'invoices.json', 'documents.json', 'README.txt']) {
      expect(names).toContain(f)
    }

    // completeness — every seeded row for office A is present
    const clients = readJsonFile('clients.json')
    expect(clients.map((c: { name: string }) => c.name).sort()).toEqual(['AA Client One', 'AA Client Two'])
    expect(readJsonFile('cases.json')).toHaveLength(2)
    expect(readJsonFile('sessions.json')).toHaveLength(2)
    expect(readJsonFile('invoices.json')).toHaveLength(2)

    // document files bundled, with real bytes
    const manifest = readJsonFile('documents.json')
    expect(manifest).toHaveLength(2)
    const docFiles = names.filter((n) => n.startsWith('documents/'))
    expect(docFiles).toHaveLength(2)
    const bodies = docFiles.map((n) => zip.readFile(n)?.toString()).sort()
    expect(bodies).toEqual(['AA document one body', 'AA document two body'])

    // isolation — not one byte of office B
    const dump = JSON.stringify([clients, readJsonFile('cases.json'), readJsonFile('invoices.json'), readJsonFile('sessions.json'), manifest])
    expect(dump).not.toContain('BB')
    expect(dump).not.toContain(b.officeId)

    // no secrets in team.json
    const team = readJsonFile('team.json')
    expect(team.length).toBeGreaterThan(0)
    for (const u of team) {
      expect(u).not.toHaveProperty('password')
      expect(u).not.toHaveProperty('twoFactorSecret')
    }

    // audit row written
    const audit = await prisma.auditLog.findFirst({
      where: { officeId: a.officeId, action: 'office.data_exported' },
    })
    expect(audit).not.toBeNull()
  })
})
