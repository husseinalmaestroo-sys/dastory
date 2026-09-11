#!/usr/bin/env node
// 10-firm pilot security audit — Section 11 (database integrity).
// Read-only. Checks every tenant-scoped table for the specific corruption
// classes a multi-tenant bug would actually produce: a child row whose
// officeId disagrees with its parent's officeId (the definitive signature of
// a cross-tenant leak or a tenant-scoping bug in a write path), orphaned
// rows pointing at a deleted parent, and duplicate unique-key violations
// that would mean a race condition slipped past the DB's own constraints.
import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()

const problems = []
function report(check, rows, describe) {
  if (rows.length > 0) problems.push({ check, count: rows.length, sample: rows.slice(0, 5).map(describe) })
  console.log(`${rows.length === 0 ? 'OK  ' : 'FAIL'}  ${check} — ${rows.length} problem row(s)`)
}

async function main() {
  console.log('=== Cross-tenant officeId mismatches (child vs. parent) ===')

  const clientCaseMismatch = await prisma.$queryRaw`
    SELECT c.id as caseId, c.officeId as caseOffice, cl.officeId as clientOffice
    FROM \`Case\` c JOIN Client cl ON c.clientId = cl.id
    WHERE c.officeId != cl.officeId`
  report('Case.officeId matches its Client.officeId', clientCaseMismatch, (r) => r)

  const caseDocMismatch = await prisma.$queryRaw`
    SELECT d.id as documentId, d.officeId as docOffice, c.officeId as caseOffice
    FROM Document d JOIN \`Case\` c ON d.caseId = c.id
    WHERE d.officeId != c.officeId`
  report('Document.officeId matches its Case.officeId (when attached)', caseDocMismatch, (r) => r)

  const caseInvoiceMismatch = await prisma.$queryRaw`
    SELECT i.id as invoiceId, i.officeId as invOffice, c.officeId as caseOffice
    FROM Invoice i JOIN \`Case\` c ON i.caseId = c.id
    WHERE i.officeId != c.officeId`
  report('Invoice.officeId matches its Case.officeId (when attached)', caseInvoiceMismatch, (r) => r)

  const clientInvoiceMismatch = await prisma.$queryRaw`
    SELECT i.id as invoiceId, i.officeId as invOffice, cl.officeId as clientOffice
    FROM Invoice i JOIN Client cl ON i.clientId = cl.id
    WHERE i.officeId != cl.officeId`
  report('Invoice.officeId matches its Client.officeId', clientInvoiceMismatch, (r) => r)

  const caseSessionMismatch = await prisma.$queryRaw`
    SELECT s.id as sessionId, s.officeId as sessOffice, c.officeId as caseOffice
    FROM Session s JOIN \`Case\` c ON s.caseId = c.id
    WHERE s.officeId != c.officeId`
  report('Session.officeId matches its Case.officeId', caseSessionMismatch, (r) => r)

  const userOwnerMismatch = await prisma.$queryRaw`
    SELECT cl.id as clientId, cl.officeId as clientOffice, u.officeId as ownerOffice
    FROM Client cl JOIN User u ON cl.ownerId = u.id
    WHERE cl.officeId != u.officeId`
  report('Client.officeId matches its owning User.officeId', userOwnerMismatch, (r) => r)

  const caseOwnerMismatch = await prisma.$queryRaw`
    SELECT c.id as caseId, c.officeId as caseOffice, u.officeId as ownerOffice
    FROM \`Case\` c JOIN User u ON c.ownerId = u.id
    WHERE c.officeId != u.officeId`
  report('Case.officeId matches its owning User.officeId', caseOwnerMismatch, (r) => r)

  const docOwnerMismatch = await prisma.$queryRaw`
    SELECT d.id as documentId, d.officeId as docOffice, u.officeId as ownerOffice
    FROM Document d JOIN User u ON d.ownerId = u.id
    WHERE d.officeId != u.officeId`
  report('Document.officeId matches its owning User.officeId', docOwnerMismatch, (r) => r)

  console.log('\n=== Orphans (row references a parent that no longer exists) ===')
  const orphanCases = await prisma.$queryRaw`SELECT c.id FROM \`Case\` c LEFT JOIN Client cl ON c.clientId = cl.id WHERE cl.id IS NULL`
  report('every Case has a real Client', orphanCases, (r) => r)

  const orphanDocsCase = await prisma.$queryRaw`SELECT d.id FROM Document d WHERE d.caseId IS NOT NULL AND NOT EXISTS (SELECT 1 FROM \`Case\` c WHERE c.id = d.caseId)`
  report('every case-attached Document points to a real Case', orphanDocsCase, (r) => r)

  const orphanUsersOffice = await prisma.$queryRaw`SELECT u.id FROM User u LEFT JOIN Office o ON u.officeId = o.id WHERE o.id IS NULL`
  report('every User has a real Office', orphanUsersOffice, (r) => r)

  const orphanSubs = await prisma.$queryRaw`SELECT s.id FROM Subscription s LEFT JOIN Office o ON s.officeId = o.id WHERE o.id IS NULL`
  report('every Subscription has a real Office', orphanSubs, (r) => r)

  console.log('\n=== Duplicate / uniqueness sanity ===')
  const dupInvoiceNumbers = await prisma.$queryRaw`
    SELECT officeId, number, COUNT(*) as c FROM Invoice GROUP BY officeId, number HAVING COUNT(*) > 1`
  report('no duplicate (officeId, invoice number) pairs', dupInvoiceNumbers, (r) => r)

  const dupUserEmails = await prisma.$queryRaw`SELECT email, COUNT(*) as c FROM User GROUP BY email HAVING COUNT(*) > 1`
  report('no duplicate User emails', dupUserEmails, (r) => r)

  console.log('\n=== Deleted-document leakage into search/case listing ===')
  const missingFileButActive = await prisma.document.findMany({
    where: { url: null },
    select: { id: true, name: true, officeId: true },
    take: 5,
  })
  console.log(`INFO  Documents with a null url (never had a file, or file cleanup already ran): ${missingFileButActive.length} sample(s) shown`, missingFileButActive)

  console.log('\n=== Row counts (sanity against the seeded pilot dataset) ===')
  const [offices, users, clients, cases, documents, invoices, sessions] = await Promise.all([
    prisma.office.count({ where: { name: { startsWith: 'Firm-' } } }),
    prisma.user.count({ where: { email: { endsWith: '@test.dastory.local' } } }),
    prisma.client.count({ where: { office: { name: { startsWith: 'Firm-' } } } }),
    prisma.case.count({ where: { office: { name: { startsWith: 'Firm-' } } } }),
    prisma.document.count({ where: { office: { name: { startsWith: 'Firm-' } } } }),
    prisma.invoice.count({ where: { office: { name: { startsWith: 'Firm-' } } } }),
    prisma.session.count({ where: { office: { name: { startsWith: 'Firm-' } } } }),
  ])
  console.table({ offices, users, clients, cases, documents, invoices, sessions })

  console.log('\n=== RESULT ===')
  if (problems.length === 0) {
    console.log('PASS — no cross-tenant officeId mismatches, no orphans, no duplicate-key violations found.')
  } else {
    console.log(`FAIL — ${problems.length} integrity problem class(es) found:`)
    console.dir(problems, { depth: 5 })
    process.exitCode = 1
  }

  await prisma.$disconnect()
}

main().catch(async (err) => {
  console.error(err)
  await prisma.$disconnect()
  process.exit(1)
})
