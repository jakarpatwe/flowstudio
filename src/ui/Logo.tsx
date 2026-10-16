/** FLOW Movement Studio logo: white hexagon with a looped "f" over a trampoline ellipse,
 *  on the brand blue tile (#619BB1). Traced from the studio's own logo file.
 *  `inverse` = blue mark on a white tile, for coloured backgrounds. */
export const LOGO_BLUE = '#619BB1';

export function Logo({ size = 56, inverse = false, title = 'FLOW Movement Studio' }: { size?: number; inverse?: boolean; title?: string }) {
  const tile = inverse ? '#fff' : LOGO_BLUE;
  const ink = inverse ? LOGO_BLUE : '#fff';
  return (
    <svg width={size} height={size} viewBox="0 0 447 447" role="img" aria-label={title} className="logo">
      <rect width="447" height="447" rx="72" fill={tile} />
      <g fill="none" stroke={ink} strokeWidth="19" strokeLinecap="round" strokeLinejoin="round">
        <path d="M166 118 H280 L336 210 L282 303 H164 L116 210 Z" />
        <path d="M188 280 V172 Q188 147 213 147 H262" />
        <ellipse cx="227" cy="207" rx="31" ry="14" />
      </g>
      <ellipse cx="224" cy="355" rx="100" ry="13" fill={ink} />
    </svg>
  );
}
