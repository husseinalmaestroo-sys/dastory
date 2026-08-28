'use client'

import { createContext, useCallback, useContext, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import type { ModalId } from '@/lib/dashboard/types'
import ModalHost from './modals/ModalHost'
import ModalOverlay from './ModalOverlay'

type ModalCtx = Record<string, string>

interface DashboardContextValue {
  isAdmin: boolean
  openModal: (id: ModalId, ctx?: ModalCtx) => void
  closeModal: () => void
  /** Bump after a mutation so mounted pages re-fetch their list data. */
  refreshKey: number
  /** Save-and-stay-open (e.g. an in-modal edit): refresh list data behind the modal without closing it. */
  bumpRefresh: () => void
  /** Save-and-close (create, or a destructive action): refresh list data and dismiss the modal. */
  notifySuccess: () => void
}

const DashboardCtx = createContext<DashboardContextValue | null>(null)

export function useDashboard() {
  const ctx = useContext(DashboardCtx)
  if (!ctx) throw new Error('useDashboard must be used within DashboardShellProvider')
  return ctx
}

export function DashboardShellProvider({ children, isAdmin }: { children: React.ReactNode; isAdmin: boolean }) {
  const router = useRouter()
  const [openModalId, setOpenModalId] = useState<ModalId | null>(null)
  const [modalCtx, setModalCtx] = useState<ModalCtx>({})
  const [refreshKey, setRefreshKey] = useState(0)

  const openModal = useCallback((id: ModalId, ctx: ModalCtx = {}) => {
    setOpenModalId(id)
    setModalCtx(ctx)
  }, [])
  const closeModal = useCallback(() => { setOpenModalId(null); setModalCtx({}) }, [])
  // Client-fetched list pages re-run their effect on refreshKey; router.refresh()
  // additionally re-runs any server-fetched data on the current route.
  const bumpRefresh = useCallback(() => {
    setRefreshKey((k) => k + 1)
    router.refresh()
  }, [router])
  const notifySuccess = useCallback(() => {
    bumpRefresh()
    closeModal()
  }, [bumpRefresh, closeModal])

  const value = useMemo(
    () => ({ isAdmin, openModal, closeModal, refreshKey, bumpRefresh, notifySuccess }),
    [isAdmin, openModal, closeModal, refreshKey, bumpRefresh, notifySuccess]
  )

  return (
    <DashboardCtx.Provider value={value}>
      {children}
      {openModalId && (
        <ModalOverlay onClose={closeModal}>
          <ModalHost id={openModalId} ctx={modalCtx} />
        </ModalOverlay>
      )}
    </DashboardCtx.Provider>
  )
}
