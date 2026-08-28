'use client'

import type { ModalId } from '@/lib/dashboard/types'
import AddCaseModal from './AddCaseModal'
import AddClientModal from './AddClientModal'
import AddSessionModal from './AddSessionModal'
import AddInvoiceModal from './AddInvoiceModal'
import EditSessionModal from './EditSessionModal'
import EditInvoiceModal from './EditInvoiceModal'
import ComposeModal from './ComposeModal'
import ClientDetailModal from './ClientDetailModal'
import CaseDetailModal from './CaseDetailModal'
import MojGuideModal from './MojGuideModal'

export default function ModalHost({ id, ctx }: { id: ModalId; ctx: Record<string, string> }) {
  if (id === 'm-add-case') return <AddCaseModal />
  if (id === 'm-add-client') return <AddClientModal />
  if (id === 'm-add-session') return <AddSessionModal />
  if (id === 'm-add-invoice') return <AddInvoiceModal />
  if (id === 'm-edit-session') return <EditSessionModal sessionId={ctx.sessionId} />
  if (id === 'm-edit-invoice') return <EditInvoiceModal invoiceId={ctx.invoiceId} />
  if (id === 'm-compose') return <ComposeModal />
  if (id === 'm-client-detail') return <ClientDetailModal clientId={ctx.clientId} />
  if (id === 'm-case-detail') return <CaseDetailModal caseId={ctx.caseId} />
  return <MojGuideModal mojService={ctx.service ?? 'دليل الخدمة'} />
}
