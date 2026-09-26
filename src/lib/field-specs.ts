import { LIMITS } from '@/lib/validation'

// Per-resource text-field specs for validateFields() — one place mapping
// request fields to their column capacity (prisma/schema.prisma).

export const CLIENT_FIELDS = {
  name: { label: 'اسم العميل', max: LIMITS.varchar },
  phone: { label: 'الهاتف', max: LIMITS.phone },
  email: { label: 'البريد الإلكتروني', max: LIMITS.email },
  idNumber: { label: 'الرقم الوطني', max: LIMITS.idNumber },
  address: { label: 'العنوان', max: LIMITS.varchar },
}

export const CASE_FIELDS = {
  number: { label: 'رقم القضية', max: LIMITS.varchar },
  title: { label: 'عنوان القضية', max: LIMITS.varchar },
  type: { label: 'نوع القضية', max: LIMITS.varchar },
  court: { label: 'المحكمة', max: LIMITS.varchar },
  notes: { label: 'الملاحظات', max: LIMITS.longText },
}

export const SESSION_FIELDS = {
  time: { label: 'وقت الجلسة', max: 20 },
  court: { label: 'المحكمة', max: LIMITS.varchar },
  judge: { label: 'القاضي', max: LIMITS.varchar },
  notes: { label: 'الملاحظات', max: LIMITS.longText },
}

export const INVOICE_FIELDS = {
  number: { label: 'رقم الفاتورة', max: LIMITS.varchar },
  notes: { label: 'الملاحظات', max: LIMITS.varchar },
}

export const TIME_ENTRY_FIELDS = {
  task: { label: 'وصف المهمة', max: LIMITS.varchar },
}

export const CALENDAR_FIELDS = {
  title: { label: 'عنوان الحدث', max: LIMITS.varchar },
  type: { label: 'نوع الحدث', max: LIMITS.calendarType },
}

export const STAFF_FIELDS = {
  name: { label: 'الاسم', max: LIMITS.personName },
  phone: { label: 'الهاتف', max: LIMITS.phone },
  barNumber: { label: 'رقم النقابة', max: LIMITS.barNumber },
}

/** Marks every listed key required, keeping label/max. */
export function required<T extends Record<string, { label: string; max: number }>, K extends keyof T>(
  spec: T,
  ...keys: K[]
): T {
  const out = { ...spec } as Record<string, { label: string; max: number; required?: boolean }>
  for (const k of keys) out[k as string] = { ...spec[k], required: true }
  return out as T
}
