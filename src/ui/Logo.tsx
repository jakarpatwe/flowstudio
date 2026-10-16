/** FLOW Movement Studio mark: hexagon "f" over a trampoline ellipse, white on a teal disc. */
export function Logo({ size = 56, title = 'FLOW Movement Studio' }: { size?: number; title?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 120 120" role="img" aria-label={title} className="logo">
      <circle cx="60" cy="60" r="60" fill="#0B7F8F" />
      <g fill="none" stroke="#fff" strokeWidth="3.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M45.75 30 H75.75 L87 52.5 L75.75 75.75 H45.75 L34.5 52.5 Z" />
        <path d="M52 69 V45 C52 40 56 36.5 60.5 36.5 C65 36.5 68.5 40 68.5 45.5 C68.5 51.5 64 56 58 56 H50" />
      </g>
      <ellipse cx="60" cy="88" rx="24" ry="2.6" fill="#fff" />
    </svg>
  );
}
