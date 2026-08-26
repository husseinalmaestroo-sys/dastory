export interface ContactSettings {
  whatsapp: string  // full number for wa.me e.g. "9627900000001"
  phone: string     // display e.g. "+962 79 000 0000"
  email: string     // e.g. "info@dostoori.jo"
}

export const CS_DEFAULTS: ContactSettings = {
  whatsapp: '9627900000001',
  phone: '+962 79 000 0000',
  email: 'info@dostoori.jo',
}

const CS_KEY = 'dstoori_contact_v1'
export const CS_EVENT = 'dstoori_contact_updated'

export function getContactSettings(): ContactSettings {
  if (typeof window === 'undefined') return CS_DEFAULTS
  try {
    const raw = localStorage.getItem(CS_KEY)
    return raw ? { ...CS_DEFAULTS, ...JSON.parse(raw) } : CS_DEFAULTS
  } catch {
    return CS_DEFAULTS
  }
}

export function saveContactSettings(s: ContactSettings): void {
  localStorage.setItem(CS_KEY, JSON.stringify(s))
  window.dispatchEvent(new Event(CS_EVENT))
}
