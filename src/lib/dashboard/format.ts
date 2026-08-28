// Shared formatting helpers used by the documents list and file-search pages.
export function docIcon(type: string) {
  if (type?.toLowerCase().includes('pdf')) return '📕'
  if (type?.toLowerCase().includes('doc')) return '📘'
  if (type?.toLowerCase().includes('xls') || type?.toLowerCase().includes('sheet')) return '📗'
  if (type?.toLowerCase().includes('image') || /\.(jpg|jpeg|png|gif|webp)/i.test(type)) return '🖼️'
  return '📄'
}

export function fmtSize(bytes: number) {
  if (bytes >= 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' MB'
  if (bytes >= 1024) return Math.round(bytes / 1024) + ' KB'
  return bytes + ' B'
}

export function fmtMinutes(minutes: number) {
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return `${h}:${String(m).padStart(2, '0')}`
}
