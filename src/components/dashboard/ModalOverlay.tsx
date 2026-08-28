'use client'

import { useEffect, useRef } from 'react'

/**
 * Wraps the modal overlay with the keyboard/focus behavior a dialog needs:
 * Escape closes it, focus moves onto it on open, and returns to whatever
 * triggered it on close. None of this existed before — the old .mo/.mbox
 * overlay was click-to-dismiss only, invisible to keyboard-only and
 * screen-reader users beyond its (now labeled) visible content.
 *
 * Deliberately doesn't add a wrapper element around the .mbox each modal
 * renders (that would sit inside .mo's flex centering and break its sizing).
 * Instead it holds a ref on the .mo backdrop it already owns and reaches
 * into the DOM for the .mbox child, which is where role="dialog"/
 * aria-modal/tabIndex live (added directly on each modal's .mbox — see the
 * modals/ directory).
 */
export default function ModalOverlay({ onClose, children }: { onClose: () => void; children: React.ReactNode }) {
  const overlayRef = useRef<HTMLDivElement>(null)
  const previouslyFocused = useRef<Element | null>(null)

  useEffect(() => {
    previouslyFocused.current = document.activeElement
    overlayRef.current?.querySelector<HTMLElement>('.mbox')?.focus()

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      if (previouslyFocused.current instanceof HTMLElement) previouslyFocused.current.focus()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div ref={overlayRef} className="mo open" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      {children}
    </div>
  )
}
