// Codebase treemap (Orientation): folders → files sized by lines, coloured by role, language,
// complexity or churn. Click a folder to zoom into it, the breadcrumb to go back, double-click a file
// to open its source. Layout: src/core/viz/treemap.ts.
import { useMemo, useRef, useState } from 'react';
import { ROLE_LABEL } from '../../core/roles';
import type { Analysis } from '../../core/types';
import { fmtNum } from '../../core/util';
import { crumbs, fileTree, findNode, startNode, treemap, type Cell } from '../../core/viz/treemap';
import { useStore } from '../../store/store';
import { Card, Chip, ConfBadge, FAMILY_LABEL, heat, langColors, ROLE_FAMILY, roleVar, Swatch, ViewSwitch, VizTip, type RoleFamily } from '../kit';
import { dur, reducedMotion } from '../motion';
import { fit, tipAt, useWidth } from './common';

type Mode = 'role' | 'lang' | 'complexity' | 'churn';
const MODES: { id: Mode; label: string }[] = [{ id: 'role', label: 'role' }, { id: 'lang', label: 'language' }, { id: 'complexity', label: 'complexity' }, { id: 'churn', label: 'churn' }];

export function Treemap({ a }: { a: Analysis }) {
  const openSource = useStore((s) => s.openSource);
  const [boxRef, width, box] = useWidth<HTMLDivElement>();
  const height = width < 640 ? 300 : 380;
  const root = useMemo(() => fileTree(a.files), [a.files]);
  const start = useMemo(() => startNode(root), [root]);
  const [path, setPath] = useState<string | null>(null);
  const node = (path !== null && findNode(root, path)) || start;
  const [mode, setMode] = useState<Mode>('role');
  const [table, setTable] = useState(false);
  const [tip, setTip] = useState<{ cell: Cell; x: number; y: number } | null>(null);
  const g = useRef<SVGGElement>(null);
  const cells = useMemo(() => treemap(node, width, height, { depth: 6, maxCells: 5000 }), [node, width, height]);

  const churn = useMemo(() => new Map((a.git?.churn ?? []).map((c) => [c.file, c.commits])), [a.git]);
  const maxChurn = useMemo(() => Math.max(1, ...churn.values()), [churn]);
  const maxCx = useMemo(() => Math.max(1, ...a.files.map((f) => f.complexity)), [a.files]);
  const lang = useMemo(() => langColors(a.l0.languages), [a.l0.languages]);
  const color = (c: Cell): string => {
    if (c.kind === 'other') return 'var(--bg4)';
    if (c.kind === 'dir') return 'var(--bg3)';
    const f = a.files[c.file!];
    if (mode === 'role') return roleVar(f.role);
    if (mode === 'lang') return lang(f.lang);
    // square root spreads the long tail so mid-range files are distinguishable
    if (mode === 'complexity') return f.complexity ? heat(Math.sqrt(f.complexity / maxCx)) : 'var(--bg4)';
    const n = churn.get(f.path) ?? 0;
    return n ? heat(Math.sqrt(n / maxChurn)) : 'var(--bg4)';
  };

  const drill = (c: Cell) => {
    if (c.kind !== 'dir') return;
    setTip(null);
    const el = g.current;
    if (!el || reducedMotion()) return setPath(c.path);
    // zoom the clicked folder up to the full canvas, then swap in its own layout
    const sx = width / Math.max(1, c.w);
    const sy = height / Math.max(1, c.h);
    const anim = el.animate([{ transform: 'none', opacity: 1 }, { transform: `translate(${-c.x * sx}px, ${-c.y * sy}px) scale(${sx}, ${sy})`, opacity: 0.4 }], { duration: dur(3), easing: 'cubic-bezier(0.22, 1, 0.36, 1)' });
    anim.onfinish = () => setPath(c.path);
  };
  const activate = (c: Cell) => (c.kind === 'dir' ? drill(c) : c.kind === 'file' ? openSource(c.path) : undefined);

  const families = useMemo(() => [...new Set(a.files.map((f) => ROLE_FAMILY[f.role]))] as RoleFamily[], [a.files]);
  const topLangs = useMemo(() => [...a.l0.languages].sort((x, y) => y.loc - x.loc).slice(0, 6), [a.l0.languages]);
  const trail = crumbs(node.path).filter((p) => p === '' || p.length >= start.path.length || start.path === '');

  return (
    <Card
      testId="treemap-card"
      title="Codebase map"
      right={
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex gap-1" role="group" aria-label="Colour by">
            {MODES.map((m) => (
              <Chip key={m.id} on={mode === m.id} onClick={() => setMode(m.id)} testId={`treemap-mode-${m.id}`} title={m.id === 'churn' && !a.git ? 'Needs git history' : undefined}>{m.label}</Chip>
            ))}
          </div>
          <ViewSwitch table={table} onChange={setTable} testId="treemap-switch" />
        </div>
      }
    >
      <p className="mb-3 text-[13px] muted">Every file as a box sized by its lines, inside its folder. Click a folder to zoom in; double-click a file to open it. Roles are inferred (heuristic).</p>
      <nav className="mb-2 flex flex-wrap items-center gap-1 text-[12.5px]" aria-label="Folder" data-testid="treemap-crumbs">
        {trail.map((p, i) => (
          <span key={p} className="flex items-center gap-1">
            {i > 0 && <span className="faint">/</span>}
            {p === node.path ? <span className="mono font-medium">{p ? p.slice(p.lastIndexOf('/') + 1) : a.name}</span> : (
              <button className="link mono" onClick={() => { setTip(null); setPath(p); }}>{p ? p.slice(p.lastIndexOf('/') + 1) : a.name}</button>
            )}
          </span>
        ))}
        <span className="tnum ml-2 faint">{fmtNum(node.files)} files · {fmtNum(node.weight)} lines</span>
      </nav>
      {table ? (
        <table className="tbl" data-testid="treemap-table">
          <thead><tr><th>Name</th><th className="num">Lines</th><th className="num">Files</th><th className="num">Share</th></tr></thead>
          <tbody>
            {node.children.slice(0, 200).map((c) => (
              <tr key={c.path}>
                <td>{c.file === undefined ? <button className="link mono" onClick={() => setPath(c.path)}>{c.name}/</button> : <button className="file mono" onClick={() => openSource(c.path)}>{c.name}</button>}</td>
                <td className="num">{fmtNum(c.weight)}</td><td className="num">{fmtNum(c.files)}</td><td className="num">{Math.round((c.weight / Math.max(1, node.weight)) * 100)}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <div ref={boxRef} className="relative" onMouseLeave={() => setTip(null)}>
          <svg width={width} height={height} className="block overflow-hidden rounded-[var(--r-sm)]" role="img" aria-label={`Treemap of ${node.path || a.name}: ${node.children.length} entries, largest ${node.children.slice(0, 3).map((c) => c.name).join(', ')}`} data-testid="treemap">
            <g ref={g} key={node.path} className="fade-in" style={{ transformOrigin: '0 0' }}>
              {cells.map((c) => {
                const label = c.kind === 'file' ? c.name : c.kind === 'dir' ? c.name + '/' : c.name;
                const showText = c.w > 34 && c.h > (c.kind === 'dir' && c.depth === 1 ? 14 : 15);
                const focusable = c.depth === 1;
                return (
                  <g
                    key={c.path}
                    className="viz-cell cursor-pointer"
                    data-testid="treemap-cell"
                    data-path={c.path}
                    data-kind={c.kind}
                    data-depth={c.depth}
                    tabIndex={focusable ? 0 : undefined}
                    role={focusable ? 'button' : undefined}
                    aria-label={focusable ? `${label}, ${fmtNum(c.weight)} lines${c.kind === 'dir' ? ', open folder' : ''}` : undefined}
                    onClick={(e) => { e.stopPropagation(); if (c.kind === 'dir') drill(c); }}
                    onDoubleClick={(e) => { e.stopPropagation(); if (c.kind === 'file') openSource(c.path); }}
                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); activate(c); } }}
                    onMouseMove={(e) => { e.stopPropagation(); setTip({ cell: c, ...tipAt(e, box) }); }}
                  >
                    <rect x={c.x + 0.5} y={c.y + 0.5} width={Math.max(0, c.w - 1)} height={Math.max(0, c.h - 1)} rx={c.kind === 'dir' ? 5 : 3} fill={color(c)} fillOpacity={c.kind === 'file' ? 0.82 : 1} stroke={c.kind === 'dir' ? 'var(--line2)' : 'var(--bg2)'} strokeWidth={1} />
                    {showText && (
                      <text x={c.x + 6} y={c.y + 13} className="pointer-events-none" fontSize={c.kind === 'dir' ? 10.5 : 11} fontWeight={500} fill={c.kind === 'file' ? 'var(--bg2)' : 'var(--fg2)'} style={c.kind === 'dir' ? { textTransform: 'uppercase', letterSpacing: '0.04em' } : undefined}>
                        {fit(label, c.w - 10, c.kind === 'file')}
                      </text>
                    )}
                  </g>
                );
              })}
            </g>
          </svg>
          {tip && <TreemapTip a={a} cell={tip.cell} x={tip.x} y={tip.y} churn={churn.get(tip.cell.path)} />}
        </div>
      )}
      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1" data-testid="treemap-legend">
        {mode === 'role' && families.map((f) => <Swatch key={f} color={`var(--r-${f})`}>{FAMILY_LABEL[f]}</Swatch>)}
        {mode === 'lang' && topLangs.map((l) => <Swatch key={l.lang} color={lang(l.lang)}>{l.lang}</Swatch>)}
        {(mode === 'complexity' || mode === 'churn') && (
          <span className="flex items-center gap-2 text-[12px] muted">
            {mode === 'complexity' ? 'Total cyclomatic complexity' : 'Commits touching the file'}: low
            <span aria-hidden="true" className="inline-block h-2 w-24 rounded-full" style={{ background: `linear-gradient(90deg, ${heat(0.05)}, ${heat(0.5)}, ${heat(0.85)}, ${heat(1)})` }} />
            high
            {mode === 'churn' && !a.git && <span className="text-[var(--warn)]">· no git history, so every file is grey</span>}
          </span>
        )}
      </div>
    </Card>
  );
}

function TreemapTip({ a, cell, x, y, churn }: { a: Analysis; cell: Cell; x: number; y: number; churn?: number }) {
  const f = cell.file !== undefined ? a.files[cell.file] : null;
  return (
    <VizTip x={x} y={y} testId="treemap-tip">
      <div className="mono break-all font-medium">{cell.kind === 'other' ? `${cell.folded} smaller entries` : cell.path + (cell.kind === 'dir' ? '/' : '')}</div>
      <div className="tnum mt-0.5 muted">{fmtNum(cell.weight)} lines{cell.kind !== 'file' && ` · ${fmtNum(cell.files)} files`}</div>
      {f && (
        <div className="mt-1 flex flex-wrap items-center gap-1.5 muted">
          <span>{ROLE_LABEL[f.role]}</span><ConfBadge c={f.roleConf} /><span>· {f.lang}</span>
          {f.complexity > 0 && <span className="tnum">· complexity {f.complexity}</span>}
          {churn !== undefined && <span className="tnum">· {churn} commits</span>}
        </div>
      )}
      {cell.kind === 'dir' && <div className="mt-1 faint">Click to zoom in</div>}
      {f && <div className="mt-1 faint">Double-click to open the source</div>}
    </VizTip>
  );
}
