// imex logo mark: two opposing arrows (import / export) on the accent square. The arrows swap rows on hover of
// `.logo-link` and while `busy` (an analysis is running); both are CSS and switch off under reduced motion.
export function LogoMark({ size = 26, busy = false }: { size?: number; busy?: boolean }) {
  return (
    <span aria-hidden="true" data-testid="logo-mark" data-busy={busy || undefined} className={`inline-grid shrink-0 place-items-center rounded-[8px] bg-[var(--accent)] ${busy ? 'logo-busy' : ''}`} style={{ width: size, height: size }}>
      <svg width={size * 0.58} height={size * 0.58} viewBox="0 0 24 24" fill="none" stroke="var(--accent-mark)" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
        <path className="logo-a" d="M4 8h13M13 4l4 4-4 4" />
        <path className="logo-b" d="M20 16H7M11 12l-4 4 4 4" />
      </svg>
    </span>
  );
}
