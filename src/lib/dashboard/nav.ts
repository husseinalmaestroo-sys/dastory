import type { NavSection } from './types'

// Section grouping and labels mirror the product's existing information
// architecture (previously encoded as BASE_NAV/ADMIN_NAV inside the old
// dashboard/page.tsx god component) — only the target (page-switch id -> URL)
// changed when each section became a real route.
export const BASE_NAV: NavSection[] = [
  { label: 'الرئيسية', items: [{ href: '/dashboard', icon: '🏠', label: 'لوحة التحكم' }] },
  {
    label: 'إدارة المكتب',
    items: [
      { href: '/dashboard/clients', icon: '👥', label: 'إدارة العملاء' },
      { href: '/dashboard/cases', icon: '⚖️', label: 'إدارة القضايا' },
      { href: '/dashboard/sessions', icon: '📅', label: 'إدارة الجلسات' },
      { href: '/dashboard/invoices', icon: '💳', label: 'الفواتير' },
      { href: '/dashboard/calendar', icon: '🗓️', label: 'التقويم الشامل' },
      { href: '/dashboard/timelog', icon: '⏱️', label: 'تتبع الوقت' },
    ],
  },
  {
    label: 'الذكاء الاصطناعي',
    items: [
      { href: '/dashboard/ai/contract', icon: '📄', label: 'مراجعة العقود AI' },
      { href: '/dashboard/ai/write', icon: '✍️', label: 'نماذج عقود قابلة للتعبئة' },
      { href: '/dashboard/ai/assistant', icon: '🤖', label: 'المساعد القانوني' },
      { href: '/dashboard/ai/case', icon: '🧠', label: 'تحليل القضايا AI' },
    ],
  },
  {
    label: 'المستندات',
    items: [
      { href: '/dashboard/documents', icon: '🗂️', label: 'إدارة الملفات' },
      { href: '/dashboard/documents/search', icon: '🔍', label: 'بحث الملفات' },
      { href: '/dashboard/documents/ocr', icon: '📷', label: 'OCR — تحويل صورة' },
      { href: '/dashboard/documents/compare', icon: '🔀', label: 'مقارنة مستندين' },
      { href: '/dashboard/documents/generate', icon: '📝', label: 'إنشاء مستندات' },
      { href: '/dashboard/documents/sign', icon: '🖊️', label: 'توقيع المستندات' },
    ],
  },
  {
    label: 'البحث',
    items: [
      { href: '/dashboard/search/legal', icon: '📚', label: 'البحث القانوني' },
      { href: '/dashboard/search/office', icon: '🏢', label: 'محرك بحث المكتب' },
    ],
  },
  {
    label: 'التواصل',
    items: [
      { href: '/dashboard/email', icon: '📧', label: 'البريد الإلكتروني' },
      { href: '/dashboard/notifications', icon: '🔔', label: 'الإشعارات' },
      { href: '/dashboard/moj', icon: '🏛️', label: 'بوابة العدل' },
      { href: '/dashboard/settings', icon: '🔐', label: 'الأمان والإعدادات' },
    ],
  },
]

export const ADMIN_NAV: NavSection = {
  label: 'إدارة المكتب — مدير',
  items: [
    { href: '/dashboard/team', icon: '👤', label: 'إدارة الفريق' },
    { href: '/dashboard/reports', icon: '📊', label: 'التقارير' },
    { href: '/dashboard/backup', icon: '💾', label: 'النسخ الاحتياطي' },
  ],
}

export const PAGE_TITLES: Record<string, string> = {
  '/dashboard': 'لوحة التحكم',
  '/dashboard/clients': 'إدارة العملاء',
  '/dashboard/cases': 'إدارة القضايا',
  '/dashboard/sessions': 'إدارة الجلسات',
  '/dashboard/invoices': 'الفواتير',
  '/dashboard/team': 'إدارة الفريق',
  '/dashboard/timelog': 'تتبع الوقت',
  '/dashboard/calendar': 'التقويم الشامل',
  '/dashboard/ai/contract': 'مراجعة العقود AI',
  '/dashboard/ai/write': 'نماذج عقود قابلة للتعبئة',
  '/dashboard/ai/assistant': 'المساعد القانوني',
  '/dashboard/ai/case': 'تحليل القضايا AI',
  '/dashboard/documents': 'إدارة الملفات',
  '/dashboard/documents/search': 'بحث الملفات',
  '/dashboard/documents/ocr': 'OCR — تحويل صورة',
  '/dashboard/documents/compare': 'مقارنة مستندين',
  '/dashboard/documents/generate': 'إنشاء مستندات',
  '/dashboard/documents/sign': 'توقيع المستندات',
  '/dashboard/search/legal': 'البحث القانوني',
  '/dashboard/search/office': 'بحث المكتب',
  '/dashboard/reports': 'التقارير',
  '/dashboard/email': 'البريد الإلكتروني',
  '/dashboard/notifications': 'الإشعارات',
  '/dashboard/moj': 'بوابة وزارة العدل',
  '/dashboard/settings': 'الأمان والإعدادات',
  '/dashboard/backup': 'النسخ الاحتياطي',
}
