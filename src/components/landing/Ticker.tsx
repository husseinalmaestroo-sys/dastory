type TickerProps = {
  items: string[]
  bg: string
  color: string
  speed: number
}

export default function Ticker({ items, bg, color, speed }: TickerProps) {
  const text = items.join('         ')

  return (
    <div
      id="site-ticker"
      style={{ background: bg, color: '#fff', padding: '10px 0', overflow: 'hidden', position: 'relative', zIndex: 60 }}
    >
      <div style={{ overflow: 'hidden' }}>
        <div id="site-ticker-inner" className="ticker-inner" style={{ fontSize: '12px', fontWeight: 700, gap: '80px', color, animationDuration: `${speed}s` }}>
          <span id="site-ticker-span1" style={{ paddingLeft: '80px' }}>{text}&nbsp;</span>
          <span id="site-ticker-span2" style={{ paddingLeft: '80px' }}>{text}&nbsp;</span>
        </div>
      </div>
    </div>
  )
}
