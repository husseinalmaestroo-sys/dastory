export async function apiFetch<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(url, { ...options, headers: { 'Content-Type': 'application/json', ...options?.headers } })
  if (!res.ok) throw new Error(await res.text())
  return res.json()
}

export const statusAr: Record<string, string> = {
  ACTIVE: 'نشطة', CLOSED: 'مغلقة', SUSPENDED: 'معلقة', PENDING: 'قيد الانتظار',
  UPCOMING: 'قادمة', DONE: 'منتهية', POSTPONED: 'مؤجلة',
  PAID: 'مدفوعة', UNPAID: 'غير مدفوعة', PARTIAL: 'جزئي', OVERDUE: 'متأخرة',
}

export const statusColor: Record<string, string> = {
  ACTIVE: '#16A34A', CLOSED: '#64748B', SUSPENDED: '#F59E0B', PENDING: '#3B82F6',
  UPCOMING: '#3B82F6', DONE: '#16A34A', POSTPONED: '#F59E0B',
  PAID: '#16A34A', UNPAID: '#EF4444', PARTIAL: '#F59E0B', OVERDUE: '#DC2626',
}

export function fmtDate(d: string | Date) {
  return new Date(d).toLocaleDateString('ar-JO', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

export function fmtMoney(n: number) {
  return n.toLocaleString('ar-JO') + ' د.أ'
}
