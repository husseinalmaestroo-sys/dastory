export interface AuthUser {
  id: string
  name: string
  email: string
  role: 'OFFICE_MANAGER' | 'LAWYER' | 'CITIZEN'
  officeId: string
  officeName: string | null
  barNumber: string | null
  clientId?: string | null
  isPlatformAdmin?: boolean
  twoFactorEnabled?: boolean
  emailVerified?: boolean
}

export type ModalId =
  | 'm-add-case'
  | 'm-add-client'
  | 'm-add-session'
  | 'm-add-invoice'
  | 'm-edit-session'
  | 'm-edit-invoice'
  | 'm-compose'
  | 'm-client-detail'
  | 'm-case-detail'
  | 'm-moj-guide'

export type ChatMessage = {
  role: 'u' | 'a'
  text: string
  citation?: string
}

export type TimeEntry = {
  id: string
  date: string
  task: string
  minutes: number
  billable: boolean
  invoiced: boolean
  case: { number: string; title: string } | null
}

export type NavItem = { href: string; icon: string; label: string }
export type NavSection = { label: string; items: NavItem[] }
