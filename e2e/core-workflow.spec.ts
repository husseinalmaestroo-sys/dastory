// Core office workflow in a real browser against the production server:
// signup -> client -> case -> document upload + download -> session ->
// invoice -> team member with restricted permissions -> logout.
// No AI (not configured here; Phase 2) and no payment path.
import { createHash, randomBytes, randomUUID } from 'crypto'
import { readFileSync } from 'fs'
import { expect, test, type Page } from '@playwright/test'
import { PrismaClient } from '@prisma/client'

const DATABASE_URL = process.env.E2E_DATABASE_URL || 'mysql://root@localhost:3307/dostoori_e2e_test'
const run = randomUUID().slice(0, 6)
const manager = { name: 'مدير الاختبار', office: `مكتب ${run}`, email: `e2e-manager-${run}@dostoori.test`, password: 'E2eManager!2345' }
const lawyer = { name: 'محامي الاختبار', email: `e2e-lawyer-${run}@dostoori.test`, password: 'E2eLawyer!2345' }
const clientName = `موكل ${run}`
const caseNo = `E2E-${run}`
const caseTitle = `دعوى اختبار ${run}`
const court = `محكمة بداية عمان ${run}`

test.describe.configure({ mode: 'serial' })

async function login(page: Page, email: string, password: string) {
  await page.goto('/login')
  await page.getByPlaceholder('example@lawfirm.jo').fill(email)
  await page.getByPlaceholder('••••••••••').fill(password)
  await page.getByRole('button', { name: 'دخول إلى لوحة التحكم' }).click()
  await page.waitForURL('**/dashboard')
}

test('anonymous visitors are sent to the login page', async ({ page }) => {
  await page.goto('/dashboard/cases')
  await expect(page).toHaveURL(/\/login$/)
  const api = await page.request.get('/api/cases')
  expect(api.status()).toBe(401)
})

test('core office workflow', async ({ page, browser }) => {
  // ---- signup (creates a new office) --------------------------------------
  await page.goto('/login')
  await page.getByRole('button', { name: 'إنشاء مكتب جديد', exact: true }).click()
  await page.getByPlaceholder('اسم المحامي / المدير').fill(manager.name)
  await page.getByPlaceholder('اختياري للمحامي المستقل').fill(manager.office)
  await page.getByPlaceholder('example@lawfirm.jo').fill(manager.email)
  await page.getByPlaceholder('8 أحرف على الأقل').fill(manager.password)
  await page.getByRole('button', { name: 'إنشاء المكتب والدخول' }).click()
  await page.waitForURL('**/dashboard')

  // Stands in for clicking the emailed verification link (no SMTP in this
  // environment). Inviting staff requires a verified email.
  const db = new PrismaClient({ datasources: { db: { url: DATABASE_URL } } })
  try {
    await db.user.update({ where: { email: manager.email }, data: { emailVerified: true } })
  } finally {
    await db.$disconnect()
  }

  // ---- client --------------------------------------------------------------
  await page.goto('/dashboard/clients')
  await page.getByRole('button', { name: '+ عميل جديد' }).first().click()
  await page.getByLabel('اسم العميل / الشركة').fill(clientName)
  await page.getByLabel('رقم الهاتف').fill('0790000000')
  await page.getByRole('button', { name: '✅ إضافة العميل' }).click()
  await expect(page.getByRole('cell', { name: clientName })).toBeVisible()

  // ---- case ----------------------------------------------------------------
  await page.goto('/dashboard/cases')
  await page.getByRole('button', { name: '+ قضية جديدة' }).first().click()
  await page.getByLabel('رقم القضية').fill(caseNo)
  await page.getByLabel('عنوان القضية').fill(caseTitle)
  await page.getByLabel('الموكل').selectOption({ label: clientName })
  await page.getByRole('button', { name: '✅ إنشاء القضية' }).click()
  await expect(page.getByText(caseTitle)).toBeVisible()

  // ---- document: upload, then download it back byte-identical --------------
  const pdf = randomBytes(64 * 1024)
  pdf.write('%PDF-1.7\n', 0, 'ascii')
  await page.goto('/dashboard/documents')
  await page.locator('input[type=file]').setInputFiles({ name: 'contract.pdf', mimeType: 'application/pdf', buffer: pdf })
  await page.getByRole('button', { name: '⬆ رفع الآن' }).click()
  await expect(page.getByText('contract.pdf')).toBeVisible()
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('link', { name: '⬇ تحميل' }).first().click(),
  ])
  const downloaded = readFileSync((await download.path())!)
  expect(createHash('sha256').update(downloaded).digest('hex')).toBe(createHash('sha256').update(pdf).digest('hex'))

  // ---- session -------------------------------------------------------------
  const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10)
  await page.goto('/dashboard/sessions')
  await page.getByRole('button', { name: '+ جلسة جديدة' }).first().click()
  await page.getByLabel('القضية', { exact: true }).selectOption({ label: `${caseNo} — ${caseTitle}` })
  await page.getByLabel('تاريخ الجلسة').fill(tomorrow)
  await page.getByLabel('الوقت').fill('10:30')
  await page.getByLabel('المحكمة').fill(court)
  await page.getByRole('button', { name: '✅ حفظ الجلسة' }).click()
  await expect(page.getByText(court)).toBeVisible()

  // ---- invoice (exact decimal money) ----------------------------------------
  await page.goto('/dashboard/invoices')
  await page.getByRole('button', { name: '+ فاتورة جديدة' }).first().click()
  await page.getByLabel('العميل', { exact: true }).selectOption({ label: clientName })
  await page.getByLabel('المبلغ (د.أ)').fill('150.250')
  await page.getByRole('button', { name: '✅ إصدار الفاتورة' }).click()
  await expect(page.getByRole('button', { name: '✏️ تعديل' })).toHaveCount(1)
  const invoices = await (await page.request.get('/api/invoices')).json()
  expect(invoices).toHaveLength(1)
  expect(invoices[0].amount).toBe(150.25)

  // ---- team: add a lawyer ---------------------------------------------------
  await page.goto('/dashboard/team')
  await page.getByRole('button', { name: '+ دعوة محامٍ' }).first().click()
  await page.getByPlaceholder('مثال: أحمد محمد الحسين').fill(lawyer.name)
  await page.getByPlaceholder('ahmed@lawfirm.jo').fill(lawyer.email)
  await page.getByPlaceholder('8 أحرف على الأقل').fill(lawyer.password)
  await page.getByPlaceholder('أعد إدخال كلمة المرور').fill(lawyer.password)
  await page.getByRole('button', { name: '✅ إنشاء الدعوة' }).click()
  await expect(page.getByText(lawyer.email)).toBeVisible()

  // ---- the lawyer's permissions are narrower than the manager's ------------
  const lawyerContext = await browser.newContext()
  try {
    const lawyerPage = await lawyerContext.newPage()
    await login(lawyerPage, lawyer.email, lawyer.password)
    // The manager's (unassigned) case is not visible to the lawyer…
    const cases = await (await lawyerPage.request.get('/api/cases')).json()
    expect(cases.map((c: { number: string }) => c.number)).not.toContain(caseNo)
    await lawyerPage.goto('/dashboard/cases')
    await expect(lawyerPage.getByText(caseTitle)).toHaveCount(0)
    // …nor are office finances, and team management is manager-only.
    expect((await lawyerPage.request.post('/api/team', { data: { name: 'x', email: `x-${run}@dostoori.test`, password: 'Whatever!2345' } })).status()).toBe(403)
  } finally {
    await lawyerContext.close()
  }

  // ---- logout: the session is gone, the dashboard is closed ----------------
  await page.goto('/dashboard')
  await page.getByRole('button', { name: /تسجيل الخروج/ }).click()
  await page.waitForURL('**/login')
  await page.goto('/dashboard')
  await expect(page).toHaveURL(/\/login$/)
  expect((await page.request.get('/api/cases')).status()).toBe(401)
})
