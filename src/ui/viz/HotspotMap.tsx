// Hotspot map (Health): complexity (y) × churn (x) per code file, bubble size = lines, colour = role.
// Without history the x axis is fan-in instead. The shaded top-right quadrant is the riskiest code.
import { useMemo, useState } from 'react';
import { ROLE_LABEL } from '../../core/roles';
import type { Analysis } from '../../core/types';
import { fmtNum } from '../../core/util';
import { hotspotScatter, type ScatterPoint } from '../../core/viz/scatter';
import { useStore } from '../../store/store';
import { Card, FileLink, PathText, RoleBadge, roleVar, ViewSwitch, VizTip } from '../kit';
import { reducedMotion } from '../motion';
import { tipAt, useWidth } from './common';

const M = { l: 44, r: 14, t: 12, b: 36 };

/** Square-root scale: skewed counts (a few huge files) still leave room for the rest. */
const sq = (v: number, max: number, len: number) => (Math.sqrt(Math.max(0, v)) / Math.sqrt(max)) * len;
function ticks(max: number): number[] {
  const out = new Set<number>([0]);
  for (const f of [0.0625, 0.25, 0.5625, 1]) out.add(Math.round(max * f));
  return [...out].sort((x, y) => x - y);
}

export function HotspotMap({ a }: { a: Analysis }) {
  const setTab = useStore((s) => s.setTab);
  const s = useMemo(() => hotspotScatter(a), [a]);
  const [boxRef, width, box] = useWidth<HTMLDivElement>();
  const [sel, setSel] = useState<ScatterPoint | null>(null);
  const [tip, setTip] = useState<{ p: ScatterPoint; x: number; y: number } | null>(null);
  const [table, setTable] = useState(false);
  if (s.points.length < 3) return null;
  const H = 320;
  const pw = Math.max(100, width - M.l - M.r);
  const ph = H - M.t - M.b;
  const X = (v: number) => M.l + sq(v, s.xMax * 1.3, pw);
  const Y = (v: number) => M.t + ph - sq(v, s.yMax * 1.3, ph);
  const maxLoc = Math.max(1, ...s.points.map((p) => p.size));
  const R = (p: ScatterPoint) => 3 + Math.sqrt(p.size / maxLoc) * 13;
  const animate = s.points.length <= 300 && !reducedMotion();
  const xName = s.x === 'churn' ? 'Commits that changed the file (churn)' : 'Files that import it (fan-in)';
  // draw big bubbles first so small ones stay clickable
  const order = [...s.points].sort((p, q) => q.size - p.size);
  return (
    <Card testId="hotspot-card" title="Hotspot map" right={<ViewSwitch table={table} onChange={setTable} testId="hotspot-switch" />}>
      <p className="mb-3 text-[13px] muted">
        Complexity against {s.x === 'churn' ? 'how often a file changes' : 'how many files depend on it'}; bubble size is lines of code. Files in the shaded corner are complex
        <i> and</i> {s.x === 'churn' ? 'change often' : 'widely used'}: the riskiest to work on. The cut-offs are this project&rsquo;s top quarter on each axis.
        {s.x === 'fan-in' && <span className="text-[var(--warn)]"> No git history, so the x axis shows fan-in instead of churn; upload with the .git folder for churn.</span>}
      </p>
      {table ? (
        <table className="tbl" data-testid="hotspot-table">
          <thead><tr><th>File</th><th className="num">{s.x === 'churn' ? 'Commits' : 'Fan-in'}</th><th className="num">Complexity</th><th className="num">Lines</th></tr></thead>
          <tbody>
            {s.points.filter((p) => p.risky).concat(s.points.filter((p) => !p.risky)).slice(0, 60).map((p) => (
              <tr key={p.file}><td><FileLink file={p.file} />{p.risky && <span className="ml-2 text-[12px] text-[var(--bad)]">risky</span>}</td><td className="num">{p.x}</td><td className="num">{p.y}</td><td className="num">{fmtNum(p.size)}</td></tr>
            ))}
          </tbody>
        </table>
      ) : (
        <div ref={boxRef} className="relative" onMouseLeave={() => setTip(null)}>
          <svg width={width} height={H} role="img" aria-label={`Hotspot map of ${s.points.length} files; ${s.risky.length} in the risky quadrant: ${s.risky.slice(0, 5).join(', ')}`} data-testid="hotspot-map">
            <rect x={X(s.xCut)} y={M.t} width={Math.max(0, M.l + pw - X(s.xCut))} height={Math.max(0, Y(s.yCut) - M.t)} fill="var(--bad-soft)" rx={6} />
            <text x={M.l + pw - 6} y={M.t + 14} textAnchor="end" fontSize={10.5} fontWeight={500} fill="var(--bad)" style={{ textTransform: 'uppercase', letterSpacing: '0.05em' }}>risky</text>
            {ticks(s.xMax).map((t) => (
              <g key={'x' + t}>
                <line x1={X(t)} x2={X(t)} y1={M.t} y2={M.t + ph} stroke="var(--line)" />
                <text x={X(t)} y={M.t + ph + 14} textAnchor="middle" fontSize={10} fill="var(--fg3)" className="tnum">{t}</text>
              </g>
            ))}
            {ticks(s.yMax).map((t) => (
              <g key={'y' + t}>
                <line x1={M.l} x2={M.l + pw} y1={Y(t)} y2={Y(t)} stroke="var(--line)" />
                <text x={M.l - 6} y={Y(t) + 3} textAnchor="end" fontSize={10} fill="var(--fg3)" className="tnum">{t}</text>
              </g>
            ))}
            <line x1={X(s.xCut)} x2={X(s.xCut)} y1={M.t} y2={M.t + ph} stroke="var(--bad)" strokeDasharray="3 3" opacity={0.5} />
            <line x1={M.l} x2={M.l + pw} y1={Y(s.yCut)} y2={Y(s.yCut)} stroke="var(--bad)" strokeDasharray="3 3" opacity={0.5} />
            <text x={M.l + pw / 2} y={H - 4} textAnchor="middle" fontSize={11} fill="var(--fg2)">{xName} →</text>
            <text transform={`translate(11, ${M.t + ph / 2}) rotate(-90)`} textAnchor="middle" fontSize={11} fill="var(--fg2)">Complexity →</text>
            {order.map((p, i) => {
              const on = sel?.file === p.file;
              return (
                <circle
                  key={p.file}
                  data-testid="hotspot-point"
                  data-file={p.file}
                  data-risky={p.risky || undefined}
                  className={`viz-cell cursor-pointer ${animate ? 'pop' : ''}`}
                  style={animate ? { animationDelay: `${Math.min(500, i * 4)}ms`, transformBox: 'fill-box', transformOrigin: 'center' } : undefined}
                  cx={X(p.x)}
                  cy={Y(p.y)}
                  r={R(p)}
                  fill={roleVar(p.role)}
                  fillOpacity={on ? 0.95 : 0.6}
                  stroke={on ? 'var(--accent)' : p.risky ? 'var(--bad)' : 'var(--bg2)'}
                  strokeWidth={on ? 2.5 : p.risky ? 1.6 : 1}
                  tabIndex={p.risky ? 0 : undefined}
                  role="button"
                  aria-label={`${p.file}: ${p.x} ${s.x}, complexity ${p.y}`}
                  onClick={() => setSel(p)}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSel(p); } }}
                  onMouseMove={(e) => setTip({ p, ...tipAt(e, box) })}
                />
              );
            })}
          </svg>
          {tip && (
            <VizTip x={tip.x} y={tip.y} testId="hotspot-tip">
              <div className="mono break-all font-medium"><PathText path={tip.p.file} /></div>
              <div className="tnum mt-0.5 muted">{tip.p.x} {s.x === 'churn' ? 'commits' : 'dependents'} · complexity {tip.p.y} · {fmtNum(tip.p.size)} lines</div>
              <div className="mt-0.5 faint">{ROLE_LABEL[tip.p.role]}{tip.p.risky ? ' · in the risky quadrant' : ''}</div>
            </VizTip>
          )}
        </div>
      )}
      {sel && (
        <div className="mt-3 flex flex-wrap items-center gap-3 rounded-[var(--r-md)] border border-[var(--line)] px-3.5 py-2.5 text-[13px] fade-in" data-testid="hotspot-detail">
          <FileLink file={sel.file} />
          <RoleBadge role={sel.role}>{ROLE_LABEL[sel.role]}</RoleBadge>
          <span className="tnum muted">{sel.x} {s.x === 'churn' ? 'commits' : 'dependents'} · complexity {sel.y} · {fmtNum(sel.size)} lines</span>
          <button className="btn ml-auto" onClick={() => setTab('impact', { file: sel.file })}>Impact</button>
        </div>
      )}
      {s.omitted > 0 && <p className="mt-2 text-xs faint">Showing the {s.points.length} highest-scoring files of {s.points.length + s.omitted}.</p>}
    </Card>
  );
}
