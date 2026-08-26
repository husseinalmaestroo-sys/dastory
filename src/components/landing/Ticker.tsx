'use client'

import { useEffect, useRef, useState } from 'react'
import { getContactSettings, CS_EVENT, CS_DEFAULTS } from '@/lib/contact-settings'

export default function Ticker() {
  const innerRef = useRef<HTMLDivElement>(null)
  const [phone, setPhone] = useState(CS_DEFAULTS.phone)

  useEffect(() => {
    const load = () => setPhone(getContactSettings().phone)
    load()
    window.addEventListener(CS_EVENT, load)
    return () => window.removeEventListener(CS_EVENT, load)
  }, [])

  // Allow admin override of bg/color/speed via legacy localStorage keys
  useEffect(() => {
    const bg    = localStorage.getItem('dstoori_ticker_bg')
    const color = localStorage.getItem('dstoori_ticker_color')
    const speed = localStorage.getItem('dstoori_ticker_speed')
    const wrap  = document.getElementById('site-ticker')
    const inner = innerRef.current
    if (bg && wrap)    (wrap as HTMLElement).style.background = bg
    if (color && inner) inner.style.color = color
    if (speed && inner) inner.style.animationDuration = speed + 's'
  }, [])

  const items = [
    `✦ للتواصل مع دُسْتُورِي عبر واتساب: ${phone}`,
    '✦ احجز Demo الآن واكتشف نظام إدارة القضايا والتشريعات والماليات من مكان واحد',
    '✦ عروض إطلاق خاصة لمكاتب المحاماة الأردنية — 3 أشهر مجاناً',
    '✦ منصة دُسْتُورِي — منظومة المحامي الذكي',
  ]
  const text = items.join('         ')

  return (
    <div
      id="site-ticker"
      style={{ background: 'var(--navy)', color: '#fff', padding: '10px 0', overflow: 'hidden', position: 'relative', zIndex: 60 }}
    >
      <div style={{ overflow: 'hidden' }}>
        <div id="site-ticker-inner" ref={innerRef} className="ticker-inner" style={{ fontSize: '12px', fontWeight: 700, gap: '80px' }}>
          <span id="site-ticker-span1" style={{ paddingLeft: '80px' }}>{text}&nbsp;</span>
          <span id="site-ticker-span2" style={{ paddingLeft: '80px' }}>{text}&nbsp;</span>
        </div>
      </div>
    </div>
  )
}
