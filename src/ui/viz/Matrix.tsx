// Dependency structure matrix (Dependencies view): row imports column; importers are ordered before
// what they import, so layers read top-down and anything below the diagonal points back up.
// Cycles are outlined in --bad, layering violations in --warn. Layout: src/core/viz/matrix.ts.
import { useMemo, useState } from 'react';
import type { Analysis } from '../../core/types';
import { buildDsm, type DsmCell } from '../../core/viz/matrix';
import { Card, ConfBadge, FileLink, heat, Swatch, ViewSwitch, VizTip } from '../kit';
import { reducedMotion } from '../motion';
import { fit, tipAt, useWidth } from './common';

const LABEL_W = 230;

export function Matrix({ a }: { a: Analysis }) {
  const dsm = useMemo(() => buildDsm(a), [a]);
  const [boxRef, width, box] = useWidth<HTMLDivElement>();
  const [sel, setSel] = useState<DsmCell | null>(null);
  const [tip, setTip] = useState<{ cell: DsmCell; x: number; y: number } | null>(null);
  const [table, setTable] = useState(false);
  const n = dsm.modules.length;
  const labelW = width < 560 ? 130 : LABEL_W;
  const size = Math.max(12, Math.min(26, Math.floor((width - labelW - 8) / Math.max(1, n))));
  const max = Math.max(1, ...dsm.cells.map((c) => c.count));
  const animate = dsm.cells.length <= 400 && !reducedMotion();
  if (n < 2) return null;
  const below = dsm.cells.filter((c) => c.row > c.col).length;
  const grid = n * size;
  const current = sel && dsm.cells.find((c) => c.row === sel.row && c.col === sel.col);
  return (
    <Card
      testId="dsm-card"
      title={`Dependency matrix (${n} ${dsm.level === 'file' ? 'files' : 'modules'})`}
      right={<ViewSwitch table={table} onChange={setTable} testId="dsm-switch" />}
    >
      <p className="mb-3 text-[13px] muted">
        Each row imports the columns it has a filled cell in; the shade is the number of imports. Rows are ordered so that importers come first, so
        a healthy layered codebase fills only the area above the diagonal. {below > 0 ? <><b>{below}</b> cell{below === 1 ? '' : 's'} below the diagonal belong to import loops.</> : 'Nothing points back up.'}
        {dsm.level !== 'file' && <> Grouped by folder (depth {dsm.level}) to stay readable.</>} Type-only imports and tests are left out.
      </p>
      {table ? (
        <table className="tbl" data-testid="dsm-table">
          <thead><tr><th>Importer</th><th>Imports</th><th className="num">Count</th><th>Notes</th></tr></thead>
          <tbody>
            {[...dsm.cells].filter((c) => c.row !== c.col).sort((x, y) => y.count - x.count).slice(0, 300).map((c) => (
              <tr key={`${c.row}:${c.col}`}>
                <td className="mono break-all">{dsm.modules[c.row].label}</td><td className="mono break-all">{dsm.modules[c.col].label}</td><td className="num">{c.count}</td>
                <td className="space-x-1">{c.cycle && <span className="text-[var(--bad)]">cycle</span>}{c.violation && <span className="text-[var(--warn)]">layering</span>}{c.conf !== 'resolved' && <ConfBadge c={c.conf} />}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <div ref={boxRef} className="relative overflow-x-auto" onMouseLeave={() => setTip(null)}>
          <svg width={labelW + grid + 2} height={grid + 22} role="img" aria-label={`Dependency matrix of ${n} modules with ${dsm.cells.length} non-empty cells; ${dsm.cells.filter((c) => c.cycle).length} in cycles, ${dsm.cells.filter((c) => c.violation).length} layering violations`} data-testid="dsm">
            {/* column numbers */}
            {dsm.modules.map((_, j) => (
              <text key={j} x={labelW + j * size + size / 2} y={14} textAnchor="middle" fontSize={9.5} fill="var(--fg3)" className="tnum">{n <= 60 && (size >= 16 || j % 2 === 0) ? j + 1 : ''}</text>
            ))}
            <g transform="translate(0, 20)">
              {dsm.modules.map((m, i) => (
                <g key={m.id}>
                  <text x={labelW - 8} y={i * size + size / 2 + 4} textAnchor="end" fontSize={11} fill="var(--fg2)"><title>{m.label}</title>{fit(m.label, labelW - 34, true)} <tspan fill="var(--fg3)" className="tnum">{i + 1}</tspan></text>
                  <rect x={labelW} y={i * size} width={grid} height={size} fill={i % 2 ? 'var(--bg)' : 'transparent'} opacity={0.6} />
                </g>
              ))}
              {/* diagonal */}
              {dsm.modules.map((_, i) => <rect key={'d' + i} x={labelW + i * size} y={i * size} width={size} height={size} fill="var(--bg4)" opacity={0.7} />)}
              <rect x={labelW} y={0} width={grid} height={grid} fill="none" stroke="var(--line2)" />
              {dsm.cells.map((c) => {
                const isSel = current === c;
                const ring = c.cycle ? 'var(--bad)' : c.violation ? 'var(--warn)' : isSel ? 'var(--accent)' : 'none';
                return (
                  <rect
                    key={`${c.row}:${c.col}`}
                    data-testid="dsm-cell"
                    data-row={c.row}
                    data-col={c.col}
                    data-cycle={c.cycle || undefined}
                    data-violation={c.violation || undefined}
                    className={`viz-cell cursor-pointer ${animate ? 'pop' : ''}`}
                    x={labelW + c.col * size + (ring === 'none' ? 1.5 : 3)}
                    y={c.row * size + (ring === 'none' ? 1.5 : 3)}
                    width={size - (ring === 'none' ? 3 : 6)}
                    height={size - (ring === 'none' ? 3 : 6)}
                    rx={3}
                    fill={c.row === c.col ? 'var(--fg3)' : c.cycle ? 'var(--bad-soft)' : c.violation ? 'var(--warn-soft)' : heat(0.2 + 0.5 * Math.sqrt(c.count / max))}
                    fillOpacity={c.row === c.col ? 0.35 : 1}
                    stroke={ring}
                    strokeWidth={ring === 'none' ? 0 : isSel ? 3 : 2.5}
                    style={{ ...(animate ? { animationDelay: `${Math.min(400, (c.row + c.col) * 12)}ms`, transformBox: 'fill-box' as const, transformOrigin: 'center' } : {}), outline: 'none' }}
                    strokeDasharray={c.violation && !c.cycle ? '3 2' : undefined}
                    tabIndex={c.row === c.col ? undefined : 0}
                    role={c.row === c.col ? undefined : 'button'}
                    aria-label={c.row === c.col ? undefined : `${dsm.modules[c.row].label} imports ${dsm.modules[c.col].label}: ${c.count}`}
                    onClick={() => setSel(c)}
                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSel(c); } }}
                    onMouseMove={(e) => setTip({ cell: c, ...tipAt(e, box) })}
                  />
                );
              })}
            </g>
          </svg>
          {tip && (
            <VizTip x={tip.x} y={tip.y} testId="dsm-tip">
              <div className="mono break-all">{dsm.modules[tip.cell.row].label}</div>
              <div className="faint">imports</div>
              <div className="mono break-all">{dsm.modules[tip.cell.col].label}</div>
              <div className="tnum mt-1 muted">{tip.cell.count} import{tip.cell.count === 1 ? '' : 's'}{tip.cell.cycle ? ' · part of an import loop' : ''}{tip.cell.violation ? ' · layering violation' : ''}</div>
            </VizTip>
          )}
        </div>
      )}
      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1">
        <Swatch color={heat(0.2)}>few imports</Swatch><Swatch color={heat(0.7)}>many imports</Swatch>
        <span className="inline-flex items-center gap-1.5 text-[12px] muted"><i aria-hidden="true" className="inline-block h-[10px] w-[10px] rounded-[3px] border-2 border-[var(--bad)] bg-[var(--bad-soft)]" />cycle</span>
        <span className="inline-flex items-center gap-1.5 text-[12px] muted"><i aria-hidden="true" className="inline-block h-[10px] w-[10px] rounded-[3px] border-2 border-dashed border-[var(--warn)] bg-[var(--warn-soft)]" />layering violation</span>
      </div>
      {current && (
        <div className="mt-4 rounded-[var(--r-md)] border border-[var(--line)] p-3.5 fade-in" data-testid="dsm-detail">
          <div className="text-[13px]"><span className="mono font-medium">{dsm.modules[current.row].label}</span> <span className="faint">imports</span> <span className="mono font-medium">{dsm.modules[current.col].label}</span> <span className="tnum faint">({current.count})</span></div>
          {current.cycle && <p className="mt-1 text-[12.5px] text-[var(--bad)]">Both depend on each other (directly or through other modules): an import loop.</p>}
          {current.violation && <p className="mt-1 text-[12.5px] text-[var(--warn)]">Contains a layering violation; see the list below.</p>}
          <ul className="mt-2 space-y-0.5 text-[12.5px]">
            {current.edges.map((e, i) => (
              <li key={i} className="flex flex-wrap items-center gap-1.5"><FileLink file={e.from} line={e.line} /><span className="faint">→</span><FileLink file={e.to} />{e.conf !== 'resolved' && <ConfBadge c={e.conf} />}</li>
            ))}
            {current.count > current.edges.length && <li className="faint">… {current.count - current.edges.length} more</li>}
          </ul>
        </div>
      )}
    </Card>
  );
}
