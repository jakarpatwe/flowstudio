/** FLOW Movement Studio mark: hexagon "f" over a trampoline ellipse.
 *  Default is white on a teal disc; `inverse` is teal on white, for teal backgrounds. */
export function Logo({ size = 56, inverse = false, title = 'FLOW Movement Studio' }: { size?: number; inverse?: boolean; title?: string }) {
  const disc = inverse ? '#fff' : '#0B7F8F';
  const ink = inverse ? '#0B7F8F' : '#fff';
  return (
    <svg width={size} height={size} viewBox="0 0 120 120" role="img" aria-label={title} className="logo">
      <circle cx="60" cy="60" r="60" fill={disc} />
      <g fill="none" stroke={ink} strokeWidth="3.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M45.75 30 H75.75 L87 52.5 L75.75 75.75 H45.75 L34.5 52.5 Z" />
        <path d="M52 69 V45 C52 40 56 36.5 60.5 36.5 C65 36.5 68.5 40 68.5 45.5 C68.5 51.5 64 56 58 56 H50" />
      </g>
      <ellipse cx="60" cy="88" rx="24" ry="2.6" fill={ink} />
    </svg>
  );
}

/** Big centred logo with the FLOW wordmark, for sign-in and loading screens. */
export function BrandLockup({ size = 112 }: { size?: number }) {
  return (
    <div className="brand-lockup">
      <Logo size={size} />
      <div className="wordmark">FLOW<small>MOVEMENT STUDIO</small></div>
    </div>
  );
}
