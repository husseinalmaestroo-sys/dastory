export function Logo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" fill="none" aria-hidden className={className}>
      <g
        stroke="currentColor"
        strokeWidth={1.6}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <circle cx="16" cy="5.5" r="1.6" />
        <path d="M16 7.1V25" />
        <path d="M6 9.5h20" />
        <path d="M16 25l-3.5 2.4M16 25l3.5 2.4" />
        <path d="M11.5 27.4h9" />
        <path d="M6 9.5v3.5M26 9.5v3.5" />
        <path d="M2.5 13a3.5 3.5 0 007 0z" />
        <path d="M22.5 13a3.5 3.5 0 007 0z" />
      </g>
    </svg>
  );
}
