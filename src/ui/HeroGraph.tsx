// Home hero picture (U4): a small graph that assembles itself once, edges drawing and nodes popping in, to say
// "files and the imports between them". Decorative (aria-hidden), token colours, static under reduced motion
// (the global rule turns every animation off, which leaves the finished picture).
const NODES: { id: string; x: number; y: number; r: number; c: string }[] = [
  { id: 'entry', x: 48, y: 140, r: 11, c: 'var(--r-route)' },
  { id: 'a', x: 128, y: 66, r: 9, c: 'var(--r-route)' },
  { id: 'b', x: 128, y: 214, r: 9, c: 'var(--r-route)' },
  { id: 'c', x: 208, y: 140, r: 12, c: 'var(--r-service)' },
  { id: 'd', x: 208, y: 44, r: 8, c: 'var(--r-service)' },
  { id: 'e', x: 208, y: 238, r: 8, c: 'var(--r-service)' },
  { id: 'f', x: 284, y: 96, r: 9, c: 'var(--r-model)' },
  { id: 'g', x: 284, y: 190, r: 9, c: 'var(--r-model)' },
  { id: 'h', x: 330, y: 143, r: 8, c: 'var(--r-int)' },
];
// [from, to, style]: solid = resolved, dashed = heuristic, dotted = unresolved (same encoding as the real map)
const EDGES: [string, string, 'solid' | 'dashed' | 'dotted'][] = [
  ['entry', 'a', 'solid'], ['entry', 'b', 'solid'], ['a', 'c', 'solid'], ['a', 'd', 'solid'], ['b', 'c', 'solid'], ['b', 'e', 'dashed'],
  ['c', 'f', 'solid'], ['c', 'g', 'solid'], ['e', 'g', 'dashed'], ['f', 'h', 'dashed'], ['g', 'h', 'dotted'],
];
const at = (id: string) => NODES.find((n) => n.id === id)!;

export function HeroGraph() {
  return (
    <svg viewBox="0 0 370 280" className="block w-full" aria-hidden="true" data-testid="hero-graph">
      <rect x={186} y={20} width={44} height={240} rx={14} fill="none" stroke="var(--line2)" strokeDasharray="2 4" className="fade-in" style={{ animationDelay: '900ms' }} />
      {EDGES.map(([from, to, style], i) => {
        const a = at(from);
        const b = at(to);
        const delay = `${200 + i * 110}ms`;
        const base = { x1: a.x, y1: a.y, x2: b.x, y2: b.y, stroke: 'var(--fg3)', strokeWidth: 1.6, strokeLinecap: 'round' as const };
        return style === 'solid'
          ? <line key={i} {...base} pathLength={1} className="draw" style={{ animationDelay: delay }} />
          : <line key={i} {...base} strokeDasharray={style === 'dashed' ? '6 4' : '1.5 5'} className="fade-in" style={{ animationDelay: delay }} />;
      })}
      {NODES.map((n, i) => (
        <circle key={n.id} cx={n.x} cy={n.y} r={n.r} fill={n.c} stroke="var(--bg)" strokeWidth={2.5} className="assemble" style={{ animationDelay: `${i * 90}ms` }} />
      ))}
    </svg>
  );
}
