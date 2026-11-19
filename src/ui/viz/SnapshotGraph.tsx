// History time-travel picture: the module graph at one architecture snapshot. Modules keep their place
// on a circle across snapshots, so playing through them shows modules appear, grow and gain dependencies.
import { useMemo } from 'react';
import type { ArchSnapshot } from '../../core/types';
import { circleLayout } from '../../core/viz/radial';
import { CountUp } from '../motion';
import { fit, useWidth } from './common';

export function SnapshotGraph({ snaps, index }: { snaps: ArchSnapshot[]; index: number }) {
  const [boxRef, width] = useWidth<HTMLDivElement>();
  const pos = useMemo(() => circleLayout(snaps.flatMap((s) => s.modules.map((m) => m.name))), [snaps]);
  const maxLoc = useMemo(() => Math.max(1, ...snaps.flatMap((s) => s.modules.map((m) => m.loc))), [snaps]);
  const snap = snaps[index];
  const H = 300;
  const R = Math.min(width / 2 - 90, H / 2 - 40);
  const cx = width / 2;
  const cy = H / 2;
  const at = (name: string) => { const p = pos.get(name) ?? { x: 0, y: 0 }; return { x: cx + p.x * R, y: cy + p.y * R }; };
  const present = new Map(snap.modules.map((m) => [m.name, m]));
  const maxCount = Math.max(1, ...snap.edges.map((e) => e.count));
  return (
    <div ref={boxRef} className="rounded-[var(--r-md)] border border-[var(--line)] bg-[var(--bg)]" data-testid="snap-graph" data-snapshot={index}>
      <div className="flex flex-wrap items-baseline justify-between gap-2 px-3.5 pt-2.5 text-[12.5px]">
        <span className="mono font-medium">{snap.label}</span>
        <span className="tnum muted"><CountUp text={String(snap.modules.length)} /> modules · <CountUp text={String(snap.files)} /> files · <CountUp text={snap.loc.toLocaleString('en-US')} /> lines</span>
      </div>
      <svg width={width} height={H} role="img" aria-label={`Modules at ${snap.label}: ${snap.modules.map((m) => m.name).join(', ')}`}>
        <defs>
          <marker id="snap-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M0,0 L8,4 L0,8 z" fill="var(--fg3)" /></marker>
        </defs>
        {snap.edges.filter((e) => present.has(e.from) && present.has(e.to) && e.from !== e.to).map((e) => {
          const a = at(e.from);
          const b = at(e.to);
          return <line key={e.from + '>' + e.to} className="fade-in" x1={a.x} y1={a.y} x2={b.x + (a.x - b.x) * 0.12} y2={b.y + (a.y - b.y) * 0.12} stroke="var(--fg3)" strokeOpacity={0.55} strokeWidth={1 + (e.count / maxCount) * 2} markerEnd="url(#snap-arrow)" />;
        })}
        {[...pos.keys()].map((name) => {
          const m = present.get(name);
          const p = at(name);
          const r = m ? 5 + Math.sqrt(m.loc / maxLoc) * 18 : 4;
          return (
            <g key={name} className="morph" style={{ transform: `translate(${p.x}px, ${p.y}px)`, opacity: m ? 1 : 0.18 }} data-module={name} data-present={m ? 'yes' : 'no'}>
              {/* the circle is drawn at radius 1 and scaled, so size changes animate with transform only */}
              <circle className="morph" r={1} style={{ transform: `scale(${r})` }} fill="var(--accent)" fillOpacity={0.75} stroke="var(--bg2)" strokeWidth={1.5 / r} />
              <text y={-r - 5} textAnchor="middle" fontSize={10.5} fill={m ? 'var(--fg2)' : 'var(--fg3)'}>{fit(name, 150, true)}</text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
