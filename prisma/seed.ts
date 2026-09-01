// DEV/DEMO SEED ONLY — never part of the production deployment path.
//
// This script WIPES existing Office/User/Client/Case data and recreates it
// with fixed, publicly-known passwords (ManagerN@2025, etc). That is fine for
// a local dev database or a disposable demo environment, and is exactly why
// it must never run against production: it would both destroy real data and
// stand up well-known credentials on a live tenant.
//
// Real production accounts are created through the app's own sign-up flow
// (POST /api/auth/signup), where the office owner picks their own password —
// see HOSTINGER_DEPLOY.md. Do not run this script on a production database.
import { PrismaClient, CaseStatus, SessionStatus, InvoiceStatus } from '@prisma/client'
import bcrypt from 'bcryptjs'

if (process.env.NODE_ENV === 'production' && process.env.ALLOW_DEV_SEED !== 'true') {
  console.error(
    '❌ Refusing to run the demo seed with NODE_ENV=production. ' +
    'This script wipes existing data and creates accounts with known passwords. ' +
    'If you really intend to seed this environment (e.g. a disposable demo), ' +
    'set ALLOW_DEV_SEED=true explicitly and re-run.'
  )
  process.exit(1)
}

const prisma = new PrismaClient()
const hash = (pw: string) => bcrypt.hash(pw, 10)

// ─── Static data ──────────────────────────────────────────────────────────────

const OFFICES = [
  { name: 'مكتب الشوبكي للمحاماة',             phone: '+96265001234', address: 'شارع الملكة نور، عمّان' },
  { name: 'مكتب النعيمي والشركاء',              phone: '+96265005678', address: 'دوار الداخلية، عمّان' },
  { name: 'مكتب الحسيني للاستشارات القانونية', phone: '+96227001234', address: 'شارع الجامعة، إربد' },
  { name: 'مكتب المرعبي وشركاه',               phone: '+96253001234', address: 'المنطقة الصناعية، الزرقاء' },
  { name: 'مكتب الطراونة للمحاماة',             phone: '+96232001234', address: 'شارع الملك الحسين، العقبة' },
]

const MANAGERS = [
  { name: 'خالد الشوبكي',  bar: '1001' },
  { name: 'نادر النعيمي',   bar: '1002' },
  { name: 'سامر الحسيني',  bar: '1003' },
  { name: 'هند المرعبي',   bar: '1004' },
  { name: 'راتب الطراونة', bar: '1005' },
]

const LAWYERS_A = [
  { name: 'سارة جبريل',    bar: '2001' },
  { name: 'رنا عليان',     bar: '2002' },
  { name: 'هبة الصلاحي',  bar: '2003' },
  { name: 'نهى الشواهين', bar: '2004' },
  { name: 'ليلى العقباوي', bar: '2005' },
]

const LAWYERS_B = [
  { name: 'أيهم القدومي',  bar: '3001' },
  { name: 'مصطفى الزيود', bar: '3002' },
  { name: 'وليد البطاينة', bar: '3003' },
  { name: 'أمير السعد',    bar: '3004' },
  { name: 'كريم الحريري', bar: '3005' },
]

// 8 clients per office — 4 per lawyer, citizen linked to client[0]
const CLIENTS: { name: string; phone: string; email: string; idNumber: string }[][] = [
  [
    { name: 'عمّار الخليل',              phone: '+962790001001', email: 'ammar@o1.jo',    idNumber: '100000001' },
    { name: 'رنا الساعد',               phone: '+962790001002', email: 'rana@o1.jo',     idNumber: '100000002' },
    { name: 'مجموعة الأمانة التجارية',  phone: '+962790001003', email: 'amana@o1.jo',   idNumber: '100000003' },
    { name: 'سامر القرعان',             phone: '+962790001004', email: 'samer@o1.jo',   idNumber: '100000004' },
  ],
  [
    { name: 'نادين العجلوني',            phone: '+962790002001', email: 'nadine@o2.jo',  idNumber: '200000001' },
    { name: 'خالد الظاهر',              phone: '+962790002002', email: 'khaled@o2.jo',  idNumber: '200000002' },
    { name: 'شركة النور للاستثمار',     phone: '+962790002003', email: 'alnour@o2.jo',  idNumber: '200000003' },
    { name: 'ليلى حداد',               phone: '+962790002004', email: 'layla@o2.jo',   idNumber: '200000004' },
  ],
  [
    { name: 'محمود البطاينة',            phone: '+962790003001', email: 'mahmoud@o3.jo', idNumber: '300000001' },
    { name: 'سلوى الزعبي',              phone: '+962790003002', email: 'salwa@o3.jo',   idNumber: '300000002' },
    { name: 'شركة إربد التجارية',       phone: '+962790003003', email: 'irbid@o3.jo',   idNumber: '300000003' },
    { name: 'هاني النجار',              phone: '+962790003004', email: 'hani@o3.jo',    idNumber: '300000004' },
  ],
  [
    { name: 'يوسف الطويل',              phone: '+962790004001', email: 'yousuf@o4.jo',  idNumber: '400000001' },
    { name: 'منار السقا',               phone: '+962790004002', email: 'manar@o4.jo',   idNumber: '400000002' },
    { name: 'مجموعة الزرقاء الصناعية', phone: '+962790004003', email: 'zarqa@o4.jo',   idNumber: '400000003' },
    { name: 'أيمن الشواهين',            phone: '+962790004004', email: 'ayman@o4.jo',   idNumber: '400000004' },
  ],
  [
    { name: 'فارس العقباوي',            phone: '+962790005001', email: 'fares@o5.jo',   idNumber: '500000001' },
    { name: 'دانا الكيلاني',            phone: '+962790005002', email: 'dana@o5.jo',    idNumber: '500000002' },
    { name: 'شركة العقبة للتنمية',     phone: '+962790005003', email: 'aqaba@o5.jo',   idNumber: '500000003' },
    { name: 'عمر الحريري',              phone: '+962790005004', email: 'omar@o5.jo',    idNumber: '500000004' },
  ],
]

// 8 cases per office: j=0-3 → lawyerA, j=4-7 → lawyerB, clientId = clients[j%4]
const CASE_TEMPLATES = [
  { type: 'مدني',           title: 'دعوى استرداد أموال',        status: 'ACTIVE'    as CaseStatus, sesSt: 'UPCOMING' as SessionStatus },
  { type: 'تجاري',          title: 'نزاع على عقد تجاري',        status: 'ACTIVE'    as CaseStatus, sesSt: 'UPCOMING' as SessionStatus },
  { type: 'عمالي',          title: 'تعويض فصل تعسفي',           status: 'SUSPENDED' as CaseStatus, sesSt: 'POSTPONED' as SessionStatus },
  { type: 'عقاري',          title: 'نزاع على ملكية عقار',       status: 'ACTIVE'    as CaseStatus, sesSt: 'UPCOMING' as SessionStatus },
  { type: 'أحوال شخصية',   title: 'قضية طلاق وحضانة',          status: 'ACTIVE'    as CaseStatus, sesSt: 'UPCOMING' as SessionStatus },
  { type: 'جنائي',          title: 'دفاع جنائي',                 status: 'PENDING'   as CaseStatus, sesSt: 'UPCOMING' as SessionStatus },
  { type: 'إداري',          title: 'طعن بقرار إداري',            status: 'ACTIVE'    as CaseStatus, sesSt: 'UPCOMING' as SessionStatus },
  { type: 'مدني',           title: 'دعوى تعويض عن أضرار',       status: 'CLOSED'    as CaseStatus, sesSt: 'DONE'     as SessionStatus },
]

const COURTS = [
  'محكمة بداية عمّان المدنية',
  'محكمة استئناف عمّان',
  'محكمة صلح عمّان',
  'محكمة تجارية عمّان',
  'محكمة شرعية عمّان',
  'محكمة بداية الزرقاء',
  'محكمة إدارية عمّان',
  'محكمة استئناف إربد',
]

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('🧹 Cleaning existing data...')
  // Order matters — children before parents. Tables added after this seed
  // was first written (e-signature, time tracking, billing, verification)
  // are cleared here too, or their FKs block the deletes below.
  await prisma.idempotencyKey.deleteMany()
  await prisma.emailVerificationToken.deleteMany()
  await prisma.aiUsageLog.deleteMany()
  await prisma.calendarEvent.deleteMany()
  await prisma.notification.deleteMany()
  await prisma.auditLog.deleteMany()
  await prisma.timeEntry.deleteMany()
  await prisma.documentSignature.deleteMany()
  await prisma.document.deleteMany()
  await prisma.session.deleteMany()
  await prisma.invoice.deleteMany()
  await prisma.case.deleteMany()
  await prisma.subscription.deleteMany()
  // Break the citizen -> Client link, then Client (its ownerId FKs User),
  // then User, then Office.
  await prisma.user.updateMany({ data: { clientId: null } })
  await prisma.client.deleteMany()
  await prisma.user.deleteMany()
  await prisma.office.deleteMany()
  console.log('✅ Clean\n')

  for (let i = 0; i < 5; i++) {
    const n = i + 1

    // ── Office
    const office = await prisma.office.create({
      data: { id: `off-${n}`, name: OFFICES[i].name, phone: OFFICES[i].phone, address: OFFICES[i].address },
    })

    // ── Manager
    const manager = await prisma.user.create({
      data: {
        id: `mgr-${n}`,
        email: `manager${n}@office${n}.jo`,
        password: await hash(`Manager${n}@2025`),
        name: MANAGERS[i].name,
        role: 'OFFICE_MANAGER',
        barNumber: MANAGERS[i].bar,
        officeId: office.id,
      },
    })

    // ── 2 Lawyers
    const lwA = await prisma.user.create({
      data: {
        id: `lwa-${n}`,
        email: `lawyer${n}a@office${n}.jo`,
        password: await hash(`Lawyer${n}a@2025`),
        name: LAWYERS_A[i].name,
        role: 'LAWYER',
        barNumber: LAWYERS_A[i].bar,
        officeId: office.id,
      },
    })
    const lwB = await prisma.user.create({
      data: {
        id: `lwb-${n}`,
        email: `lawyer${n}b@office${n}.jo`,
        password: await hash(`Lawyer${n}b@2025`),
        name: LAWYERS_B[i].name,
        role: 'LAWYER',
        barNumber: LAWYERS_B[i].bar,
        officeId: office.id,
      },
    })

    // ── 8 Clients: first 4 belong to lawyer A, next 4 to lawyer B.
    const clientInputs = [
      ...CLIENTS[i],
      ...CLIENTS[i].map((cd, j) => ({
        ...cd,
        name: `${cd.name} — ملف ${j + 5}`,
        phone: cd.phone.replace(/(\d{3})$/, (m) => String(Number(m) + 100).padStart(3, '0')),
        email: cd.email.replace('@', `.b@`),
        idNumber: `${cd.idNumber}B`,
      })),
    ]

    const clients = await Promise.all(
      clientInputs.map((cd, j) =>
        prisma.client.create({
          data: {
            id: `cl-${n}-${j + 1}`,
            ...cd,
            officeId: office.id,
            ownerId: j < 4 ? lwA.id : lwB.id,
          },
        })
      )
    )

    // ── Citizen linked to client[0]
    await prisma.user.create({
      data: {
        id: `ctz-${n}`,
        email: `citizen${n}@office${n}.jo`,
        password: await hash(`Citizen${n}@2025`),
        name: clients[0].name,
        role: 'CITIZEN',
        phone: clients[0].phone,
        officeId: office.id,
        clientId: clients[0].id,
      },
    })

    // ── 8 Cases, sessions, invoices, docs
    const cases = []
    for (let j = 0; j < 8; j++) {
      const tmpl    = CASE_TEMPLATES[j]
      const lawyerId = j < 4 ? lwA.id : lwB.id
      const client   = clients[j]
      const year     = 2024 + (j % 2)
      const caseNum  = `${year}/${n}${String(j + 1).padStart(3, '0')}`
      const shortName = client.name.split(' ').slice(0, 2).join(' ')

      const c = await prisma.case.create({
        data: {
          id: `case-${n}-${j + 1}`,
          number: caseNum,
          title: `${tmpl.title} — ${shortName}`,
          type: tmpl.type,
          court: COURTS[j],
          status: tmpl.status,
          clientId: client.id,
          lawyerId,
          ownerId: lawyerId,
          officeId: office.id,
        },
      })
      cases.push(c)

      // Session
      await prisma.session.create({
        data: {
          id: `ses-${n}-${j + 1}`,
          date: new Date(2026, 6 + Math.floor(j / 4), 2 + (j % 4) * 5),
          time: `${9 + (j % 4)}:30`,
          court: COURTS[j],
          caseId: c.id,
          officeId: office.id,
          status: tmpl.sesSt,
        },
      })

      // Invoice
      const amount = 300 + (j + 1) * 150 + n * 50
      const paid   = j < 2 ? amount : j < 5 ? Math.floor(amount / 2) : 0
      const invStatus: InvoiceStatus =
        j < 2 ? 'PAID' : j < 5 ? 'PARTIAL' : j === 7 ? 'OVERDUE' : 'UNPAID'

      await prisma.invoice.create({
        data: {
          id: `inv-${n}-${j + 1}`,
          number: `INV-${n}-${String(j + 1).padStart(3, '0')}`,
          amount,
          paid,
          status: invStatus,
          clientId: client.id,
          caseId: c.id,
          officeId: office.id,
          dueDate: new Date(2026, 7, 1 + j * 4),
        },
      })

      // Document (first 3 cases only)
      if (j < 3) {
        await prisma.document.create({
          data: {
            id: `doc-${n}-${j + 1}`,
            name: `${tmpl.title.replace(/ /g, '_')}.pdf`,
            type: 'PDF',
            size: 400000 + j * 120000,
            caseId: c.id,
            officeId: office.id,
            ownerId: lawyerId,
          },
        })
      }
    }

    // ── Notifications
    await prisma.notification.createMany({
      data: [
        { id: `ntf-${n}-1`, title: 'جلسة قادمة',    body: `جلسة غداً في ${COURTS[0]}`,          userId: manager.id, officeId: office.id },
        { id: `ntf-${n}-2`, title: 'موكل جديد',     body: `تمت إضافة موكل: ${clients[2].name}`,  userId: lwA.id,     officeId: office.id },
        { id: `ntf-${n}-3`, title: 'فاتورة مستحقة', body: 'فاتورة تستحق هذا الأسبوع',            userId: manager.id, officeId: office.id, read: true },
      ],
    })

    // ── Calendar events
    await prisma.calendarEvent.createMany({
      data: [
        { id: `ev-${n}-1`, title: `جلسة — ${cases[0].number}`, date: new Date(2026, 6, 3 + n),  type: 'session', officeId: office.id },
        { id: `ev-${n}-2`, title: `جلسة — ${cases[4].number}`, date: new Date(2026, 6, 10 + n), type: 'session', officeId: office.id },
      ],
    })

    console.log(`✅ [${n}/5] ${OFFICES[i].name}`)
    console.log(`     manager${n}@office${n}.jo     → Manager${n}@2025`)
    console.log(`     lawyer${n}a@office${n}.jo     → Lawyer${n}a@2025  (${LAWYERS_A[i].name})`)
    console.log(`     lawyer${n}b@office${n}.jo     → Lawyer${n}b@2025  (${LAWYERS_B[i].name})`)
    console.log(`     citizen${n}@office${n}.jo     → Citizen${n}@2025  (موكل: ${clients[0].name})`)
    console.log(`     ${cases.length} قضية، ${cases.length} جلسة، ${cases.length} فاتورة، 3 مستندات\n`)
  }

  console.log('🎉 Done!')
  console.log('   5 مكاتب | 10 محامين + 5 مديرين | 40 موكلاً | 40 قضية | 5 مواطنين')
}

main().catch(e => { console.error(e); process.exit(1) }).finally(() => prisma.$disconnect())
