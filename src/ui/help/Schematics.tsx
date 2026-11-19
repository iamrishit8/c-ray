// Small drawn schematics for the Home manual (U4): what a treemap, matrix, hotspot map, blast radius, ER card, flow,
// system map and activity calendar look like. Inline SVG with token colours, so they follow light/dark and never go
// stale like screenshots. They illustrate the idea; they are not data and carry no numbers.
import type { ReactNode } from 'react';
import { heat } from '../kit';
import { SCHEMATICS, type SchematicId } from './content';

const T = { fg2: 'var(--fg2)', fg3: 'var(--fg3)', line: 'var(--line2)', bg: 'var(--bg)', card: 'var(--bg2)' };
const FONT = { fontFamily: 'var(--font-mono)', fontSize: 8 } as const;

function Frame({ id, children }: { id: SchematicId; children: ReactNode }) {
  const { title, caption } = SCHEMATICS[id];
  return (
    <figure className="m-0" data-testid="help-schematic" data-schematic={id}>
      <svg viewBox="0 0 240 150" className="block w-full rounded-[var(--r-md)] border border-[var(--line)] bg-[var(--bg)]" role="img" aria-label={`${title} (illustration)`}>
        {children}
      </svg>
      <figcaption className="mt-1.5 text-[12px] muted">{caption}</figcaption>
    </figure>
  );
}

function Treemap() {
  const cells: [number, number, number, number, string][] = [
    [8, 8, 92, 78, 'var(--r-service)'], [104, 8, 60, 44, 'var(--r-route)'], [168, 8, 64, 44, 'var(--r-route)'], [104, 56, 40, 30, 'var(--r-model)'],
    [148, 56, 40, 30, 'var(--r-model)'], [192, 56, 40, 30, 'var(--r-test)'], [8, 90, 56, 52, 'var(--r-int)'], [68, 90, 82, 52, 'var(--r-service)'],
    [154, 90, 36, 52, 'var(--r-config)'], [194, 90, 38, 52, 'var(--r-test)'],
  ];
  return (
    <Frame id="treemap">
      {cells.map(([x, y, w, h, c], i) => <rect key={i} x={x} y={y} width={w} height={h} rx={3} fill={`color-mix(in srgb, ${c} 38%, var(--bg2))`} stroke={c} strokeWidth={1.2} />)}
      <text x={14} y={22} {...FONT} fill={T.fg2}>services/</text>
      <text x={110} y={22} {...FONT} fill={T.fg2}>routes/</text>
    </Frame>
  );
}

function Graph() {
  const nodes: [number, number, string][] = [[32, 75, 'var(--r-route)'], [98, 32, 'var(--r-service)'], [98, 118, 'var(--r-service)'], [168, 75, 'var(--r-model)'], [214, 32, 'var(--r-int)']];
  return (
    <Frame id="graph">
      <rect x={72} y={12} width={54} height={126} rx={8} fill="none" stroke={T.line} strokeDasharray="2 3" />
      <text x={99} y={10} textAnchor="middle" {...FONT} fill={T.fg3}>services</text>
      <line x1={32} y1={75} x2={98} y2={32} stroke={T.fg2} strokeWidth={1.4} />
      <line x1={32} y1={75} x2={98} y2={118} stroke={T.fg2} strokeWidth={1.4} strokeDasharray="5 3" />
      <line x1={98} y1={32} x2={168} y2={75} stroke={T.fg2} strokeWidth={1.4} />
      <line x1={98} y1={118} x2={168} y2={75} stroke={T.fg2} strokeWidth={1.4} strokeDasharray="5 3" />
      <line x1={168} y1={75} x2={214} y2={32} stroke={T.fg2} strokeWidth={1.4} strokeDasharray="1.5 3.5" strokeLinecap="round" />
      {nodes.map(([x, y, c], i) => <circle key={i} cx={x} cy={y} r={9} fill={c} stroke="var(--bg)" strokeWidth={2} />)}
      <g {...FONT} fill={T.fg3}>
        <text x={110} y={146}>solid · dashed · dotted</text>
      </g>
    </Frame>
  );
}

function Flow() {
  const steps: [string, string][] = [['route', 'var(--r-route)'], ['auth', 'var(--r-route)'], ['handler', 'var(--r-route)'], ['service', 'var(--r-service)'], ['model', 'var(--r-model)']];
  return (
    <Frame id="flow">
      {steps.map(([label, c], i) => {
        const y = 10 + i * 27;
        return (
          <g key={label}>
            {i > 0 && <line x1={18 + (i - 1) * 4} y1={y - 5} x2={18 + i * 4} y2={y + 1} stroke={T.line} />}
            <circle cx={18 + i * 4} cy={y + 8} r={7} fill={`color-mix(in srgb, ${c} 38%, var(--bg2))`} stroke={c} />
            <text x={18 + i * 4} y={y + 11} textAnchor="middle" {...FONT} fill="var(--fg)">{i + 1}</text>
            <rect x={44 + i * 4} y={y} width={150 - i * 4} height={16} rx={4} fill={T.card} stroke={T.line} />
            <text x={50 + i * 4} y={y + 11} {...FONT} fill="var(--fg)">{label}</text>
            <rect x={160} y={y + 4} width={26} height={8} rx={4} fill="none" stroke={i === 2 ? 'var(--warn)' : 'var(--ok)'} strokeDasharray={i === 2 ? '3 2' : undefined} />
          </g>
        );
      })}
    </Frame>
  );
}

function Er() {
  const card = (x: number, y: number, name: string, fields: string[], key: number) => (
    <g>
      <rect x={x} y={y} width={84} height={22 + fields.length * 13} rx={6} fill={T.card} stroke={T.line} />
      <text x={x + 8} y={y + 14} {...FONT} fill="var(--fg)" fontWeight={600}>{name}</text>
      <line x1={x} x2={x + 84} y1={y + 20} y2={y + 20} stroke={T.line} />
      {fields.map((f, i) => (
        <text key={f} x={x + 8} y={y + 33 + i * 13} {...FONT} fill={i === key ? 'var(--accent-text)' : T.fg2}>{i === key ? '⚿ ' : ''}{f}</text>
      ))}
    </g>
  );
  return (
    <Frame id="er">
      <path d="M92 52 H148" stroke={T.fg2} strokeWidth={1.4} fill="none" />
      <path d="M92 52 l6 -4 M92 52 l6 4" stroke={T.fg2} fill="none" />
      <path d="M148 52 v-6 M148 52 v6" stroke={T.fg2} />
      {card(8, 24, 'Order', ['id', 'user', 'total'], 1)}
      {card(148, 24, 'User', ['id', 'email', 'name'], 0)}
    </Frame>
  );
}

function Matrix() {
  const n = 6;
  const size = 20;
  const x0 = 60;
  const y0 = 14;
  const filled = new Set(['1,0', '2,0', '2,1', '3,1', '4,2', '4,3', '5,3', '5,4', '2,3']);
  return (
    <Frame id="matrix">
      {Array.from({ length: n * n }, (_, k) => {
        const r = Math.floor(k / n);
        const c = k % n;
        const on = filled.has(`${r},${c}`);
        return <rect key={k} x={x0 + c * size} y={y0 + r * size} width={size - 2} height={size - 2} rx={3} fill={r === c ? 'var(--bg4)' : on ? heat(0.45) : 'var(--bg3)'} />;
      })}
      <rect x={x0 + 3 * size - 1} y={y0 + 2 * size - 1} width={size} height={size} rx={4} fill="none" stroke="var(--bad)" strokeWidth={1.6} />
      <rect x={x0 + 1 * size - 1} y={y0 + 3 * size - 1} width={size} height={size} rx={4} fill="none" stroke="var(--bad)" strokeWidth={1.6} />
      <text x={x0 - 6} y={y0 + 14} textAnchor="end" {...FONT} fill={T.fg3}>api</text>
      <text x={x0 - 6} y={y0 + 14 + 5 * size} textAnchor="end" {...FONT} fill={T.fg3}>data</text>
      <text x={x0 + n * size + 8} y={y0 + 2 * size + 11} {...FONT} fill="var(--bad)">cycle</text>
    </Frame>
  );
}

function Hotspot() {
  const dots: [number, number, number, string][] = [[40, 108, 7, 'var(--r-service)'], [64, 92, 5, 'var(--r-route)'], [84, 100, 8, 'var(--r-model)'], [104, 70, 6, 'var(--r-service)'], [150, 46, 12, 'var(--r-service)'], [190, 30, 9, 'var(--r-route)'], [172, 88, 6, 'var(--r-int)'], [122, 118, 5, 'var(--r-test)']];
  return (
    <Frame id="hotspot">
      <rect x={130} y={12} width={96} height={56} fill="color-mix(in srgb, var(--bad) 12%, transparent)" rx={4} />
      <path d="M20 132 H228 M20 132 V12" stroke={T.line} fill="none" />
      <text x={228} y={143} textAnchor="end" {...FONT} fill={T.fg3}>churn →</text>
      <text x={24} y={20} {...FONT} fill={T.fg3}>complexity ↑</text>
      <text x={222} y={24} textAnchor="end" {...FONT} fill="var(--bad)">risky</text>
      {dots.map(([x, y, r, c], i) => <circle key={i} cx={x} cy={y} r={r} fill={`color-mix(in srgb, ${c} 70%, transparent)`} stroke={c} />)}
    </Frame>
  );
}

function Blast() {
  return (
    <Frame id="blast">
      {[58, 40, 22].map((r, i) => <circle key={r} cx={120} cy={75} r={r} fill="none" stroke={T.line} strokeDasharray={i === 0 ? '2 3' : undefined} />)}
      {[[120, 75, 'var(--accent)', 8], [136, 56, 'var(--r-service)', 5], [104, 94, 'var(--r-service)', 5], [158, 82, 'var(--r-route)', 5], [90, 50, 'var(--r-test)', 5], [176, 40, 'var(--r-route)', 5], [70, 100, 'var(--r-test)', 5]].map(([x, y, c, r], i) => (
        <circle key={i} cx={x as number} cy={y as number} r={r as number} fill={c as string} stroke="var(--bg)" strokeWidth={1.5} />
      ))}
      <text x={120} y={78} textAnchor="middle" {...FONT} fill="var(--accent-fg)" fontSize={6}>you</text>
      <text x={146} y={20} {...FONT} fill={T.fg3}>1 step</text>
      <text x={172} y={14} {...FONT} fill={T.fg3}>2 steps</text>
    </Frame>
  );
}

function Calendar() {
  const weeks = 26;
  const level = (w: number, d: number) => ((w * 7 + d * 3) % 11 < 3 ? 0 : (w * 5 + d) % 4) / 3;
  return (
    <Frame id="calendar">
      {Array.from({ length: weeks * 7 }, (_, k) => {
        const w = Math.floor(k / 7);
        const d = k % 7;
        const v = w > 6 && w < 10 ? 0 : level(w, d);
        return <rect key={k} x={10 + w * 8.7} y={22 + d * 14} width={7} height={11} rx={2} fill={v === 0 ? 'var(--bg3)' : heat(v)} />;
      })}
      <text x={10} y={14} {...FONT} fill={T.fg3}>Jan</text>
      <text x={120} y={14} {...FONT} fill={T.fg3}>Jun</text>
    </Frame>
  );
}

const MAP: Record<SchematicId, () => ReactNode> = { treemap: Treemap, graph: Graph, flow: Flow, er: Er, matrix: Matrix, hotspot: Hotspot, blast: Blast, calendar: Calendar };

export function Schematic({ id }: { id: SchematicId }) {
  const Pic = MAP[id];
  return <Pic />;
}
