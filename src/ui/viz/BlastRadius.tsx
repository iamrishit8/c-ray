// Impact blast radius: the target in the centre, dependents on rings by import distance ("direct",
// "2 steps", …), tests and files with affected entry points marked. Rings ripple outward when the target
// changes. Layout: src/core/viz/radial.ts.
import { useMemo, useState } from 'react';
import type { Impact, ImpactedFile } from '../../core/impact';
import { radialLayout } from '../../core/viz/radial';
import { useStore } from '../../store/store';
import { Card, PathText, Swatch, VizTip } from '../kit';
import { reducedMotion } from '../motion';
import { tipAt, useWidth } from './common';

const MAX_RINGS = 5;

export function BlastRadius({ impact }: { impact: Impact }) {
  const openSource = useStore((s) => s.openSource);
  const [boxRef, width, box] = useWidth<HTMLDivElement>();
  const [tip, setTip] = useState<{ f: ImpactedFile; x: number; y: number } | null>(null);
  const entryFiles = useMemo(() => new Set(impact.entries.map((e) => e.file)), [impact]);
  const { rings, items } = useMemo(() => {
    const groups: ImpactedFile[][] = Array.from({ length: Math.min(MAX_RINGS, Math.max(1, ...impact.files.map((f) => f.distance))) }, () => []);
    for (const f of impact.files) groups[Math.min(MAX_RINGS, f.distance) - 1].push(f);
    return radialLayout(groups, { maxPerRing: 80 });
  }, [impact]);
  if (impact.files.length === 0) return null;
  const H = Math.min(440, Math.max(300, width * 0.6));
  const R = H / 2 - 26;
  const cx = width / 2;
  const cy = H / 2;
  const animate = !reducedMotion() && items.length <= 300;
  const ringLabel = (k: number) => (k === 1 ? 'direct' : k === MAX_RINGS && rings.length === MAX_RINGS ? `${k}+ steps` : `${k} steps`);
  return (
    <Card testId="blast-card" title="Blast radius" right={<span className="text-xs faint">rings = import steps away</span>}>
      <p className="mb-2 text-[13px] muted">Every file that depends on {impact.label}, placed by how many import steps separate it from the target. Squares are tests; outlined dots hold an affected entry point. Click a dot to open the file.</p>
      <div ref={boxRef} className="relative" onMouseLeave={() => setTip(null)}>
        <svg key={impact.label} width={width} height={H} role="img" data-testid="blast-radius" aria-label={`Blast radius of ${impact.label}: ${rings.map((r) => `${r.count} ${ringLabel(r.ring)}`).join(', ')}`}>
          {rings.map((r, i) => (
            <g key={r.ring} data-testid="blast-ring" data-ring={r.ring} data-count={r.count}>
              <circle cx={cx} cy={cy} r={r.radius * R} fill="none" stroke="var(--line2)" strokeDasharray={r.ring === 1 ? undefined : '3 4'} className={animate ? 'ripple' : ''} style={animate ? { animationDelay: `${i * 110}ms` } : undefined} />
              <text x={cx} y={cy - r.radius * R - 5} textAnchor="middle" fontSize={10.5} fill="var(--fg3)" style={{ textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                {ringLabel(r.ring)} · {r.count}{r.shown < r.count ? ` (${r.shown} shown)` : ''}
              </text>
            </g>
          ))}
          <circle cx={cx} cy={cy} r={9} fill="var(--accent)" className={animate ? 'pop' : ''} style={animate ? { transformBox: 'fill-box', transformOrigin: 'center' } : undefined} />
          {items.map((it, i) => {
            const f = it.item;
            const x = cx + it.x * R;
            const y = cy + it.y * R;
            const color = f.test ? 'var(--r-test)' : f.conf === 'resolved' ? 'var(--r-service)' : 'var(--warn)';
            const style = animate ? { animationDelay: `${(it.ring - 1) * 110 + 120 + Math.min(200, i)}ms`, transformBox: 'fill-box' as const, transformOrigin: 'center' } : undefined;
            const common = {
              'data-testid': 'blast-dot', 'data-file': f.file, 'data-test': f.test || undefined, 'data-entry': entryFiles.has(f.file) || undefined,
              className: `viz-cell cursor-pointer ${animate ? 'pop' : ''}`, style, role: 'button', tabIndex: it.ring === 1 ? 0 : undefined,
              'aria-label': `${f.file}, ${ringLabel(it.ring)}${f.test ? ', test' : ''}`,
              onClick: () => openSource(f.file, f.sites[0]),
              onKeyDown: (e: React.KeyboardEvent) => { if (e.key === 'Enter') openSource(f.file, f.sites[0]); },
              onMouseMove: (e: React.MouseEvent) => setTip({ f, ...tipAt(e, box) }),
              stroke: entryFiles.has(f.file) ? 'var(--accent)' : 'var(--bg2)', strokeWidth: entryFiles.has(f.file) ? 2.2 : 1,
              fill: color,
            };
            return f.test ? <rect key={f.file} x={x - 5} y={y - 5} width={10} height={10} rx={2} {...common} /> : <circle key={f.file} cx={x} cy={y} r={5.5} {...common} />;
          })}
        </svg>
        {tip && (
          <VizTip x={tip.x} y={tip.y} testId="blast-tip">
            <div className="mono break-all font-medium"><PathText path={tip.f.file} /></div>
            <div className="mt-0.5 muted">{tip.f.distance === 1 ? 'imports the target directly' : `${tip.f.distance} import steps away`}{tip.f.test ? ' · test' : ''}{entryFiles.has(tip.f.file) ? ' · has an affected entry point' : ''}</div>
            <div className="faint">confidence: {tip.f.conf}</div>
          </VizTip>
        )}
      </div>
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
        <Swatch color="var(--accent)" square={false}>target</Swatch>
        <Swatch color="var(--r-service)" square={false}>dependent (resolved)</Swatch>
        <Swatch color="var(--warn)" square={false}>dependent (heuristic edge)</Swatch>
        <Swatch color="var(--r-test)">test</Swatch>
        <span className="inline-flex items-center gap-1.5 text-[12px] muted"><i aria-hidden="true" className="inline-block h-[10px] w-[10px] rounded-full border-2 border-[var(--accent)]" />affected entry point</span>
      </div>
    </Card>
  );
}
