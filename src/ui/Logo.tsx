// imex logo mark: two opposing arrows (import / export) on the accent square.
export function LogoMark({ size = 26 }: { size?: number }) {
  return (
    <span aria-hidden="true" className="inline-grid shrink-0 place-items-center rounded-[8px] bg-[var(--accent)]" style={{ width: size, height: size }}>
      <svg width={size * 0.58} height={size * 0.58} viewBox="0 0 24 24" fill="none" stroke="var(--accent-mark)" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
        <path d="M4 8h13M13 4l4 4-4 4" />
        <path d="M20 16H7M11 12l-4 4 4 4" />
      </svg>
    </span>
  );
}
