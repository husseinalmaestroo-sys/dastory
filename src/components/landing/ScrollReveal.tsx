'use client'

import { useEffect } from 'react'

/** Fades/slides `.rv`-marked elements in as they scroll into view. No output of its own. */
export default function ScrollReveal() {
  useEffect(() => {
    const els = document.querySelectorAll('.rv')
    const obs = new IntersectionObserver((entries) => {
      entries.forEach((e, i) => {
        if (e.isIntersecting) {
          setTimeout(() => e.target.classList.add('on'), i * 65)
          obs.unobserve(e.target)
        }
      })
    }, { threshold: 0.07 })
    els.forEach((el) => obs.observe(el))
    return () => obs.disconnect()
  }, [])

  return null
}
