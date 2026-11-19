// Small spot illustrations for empty states (U4): what is missing, drawn as an outline of the thing that would be
// here. Inline SVG, token colours, decorative (the text beside them says everything). Shown by `Empty art=…`.
import type { ReactNode } from 'react';

export type ArtKind = 'history' | 'data' | 'entries' | 'findings';

const S = { fill: 'none', stroke: 'var(--line2)', strokeWidth: 1.6, strokeLinecap: 'round', strokeLinejoin: 'round' } as const;

const ART: Record<ArtKind, ReactNode> = {
  // an empty activity calendar and a branch with hollow commits
  history: (
    <>
      {Array.from({ length: 5 }, (_, c) => Array.from({ length: 3 }, (_, r) => <rect key={`${c}${r}`} x={8 + c * 13} y={6 + r * 13} width={10} height={10} rx={2.5} {...S} strokeDasharray="2 3" />))}
      <path d="M12 56 H78 M44 56 C44 48 60 48 60 40" {...S} />
      {[12, 44, 78].map((x) => <circle key={x} cx={x} cy={56} r={3.5} fill="var(--bg)" stroke="var(--fg3)" strokeWidth={1.6} />)}
      <circle cx={60} cy={40} r={3.5} fill="var(--bg)" stroke="var(--fg3)" strokeWidth={1.6} />
    </>
  ),
  // a table card with ghost rows and a dotted relation to a second card
  data: (
    <>
      <rect x={6} y={10} width={40} height={42} rx={6} {...S} />
      <path d="M6 22 H46" {...S} />
      {[32, 40, 48].map((y) => <path key={y} d={`M12 ${y} H${y === 40 ? 30 : 38}`} {...S} strokeDasharray="1 4" />)}
      <path d="M46 36 H62" {...S} strokeDasharray="2 4" />
      <rect x={62} y={18} width={28} height={30} rx={6} {...S} strokeDasharray="3 4" />
    </>
  ),
  // an arrow reaching for a door that is not there
  entries: (
    <>
      <path d="M6 36 H52" {...S} />
      <path d="M44 28 L52 36 L44 44" {...S} />
      <path d="M62 56 V18 a14 14 0 0 1 28 0 V56" {...S} strokeDasharray="3 4" />
      <path d="M56 56 H96" {...S} />
    </>
  ),
  // a shield with a tick: nothing to flag
  findings: (
    <>
      <path d="M48 8 L74 18 V36 C74 48 62 56 48 62 C34 56 22 48 22 36 V18 Z" {...S} />
      <path d="M37 35 L45 43 L60 26" fill="none" stroke="var(--ok)" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" />
    </>
  ),
};

export function Art({ kind }: { kind: ArtKind }) {
  return (
    <svg viewBox="0 0 96 68" width={96} height={68} className="mx-auto mb-3 block" aria-hidden="true" data-testid="empty-art" data-art={kind}>
      {ART[kind]}
    </svg>
  );
}
