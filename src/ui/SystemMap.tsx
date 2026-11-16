import { useEffect, useMemo, useState } from 'react';
import type { Core, ElementDefinition } from 'cytoscape';
import { buildMapView, defaultExpanded, DIR_PREFIX, filesUnder, type MapFilter } from '../core/mapview';
import { modelOf } from '../core/model';
import { ROLE_LABEL } from '../core/roles';
import type { Analysis, Confidence } from '../core/types';
import { dirname, fmtNum, uniq } from '../core/util';
import { useStore } from '../store/store';
import { worker } from '../workers/client';
import { Graph } from './Graph';
import { Badge, ConfBadge, FileLink } from './kit';

const MAX_NODES = 500;
const CONFS: Confidence[] = ['resolved', 'heuristic', 'unresolved'];

function Preview({ path }: { path: string }) {
  const [text, setText] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    setText(null);
    worker.call('source', { path }).then((r) => live && setText(r.text ?? '')).catch(() => live && setText(''));
    return () => { live = false; };
  }, [path]);
  if (text === null) return <div className="faint text-xs">Loading preview…</div>;
  if (!text) return <div className="faint text-xs">Source preview not available.</div>;
  return <pre className="max-h-56 overflow-auto rounded border border-[var(--line)] bg-[var(--bg2)] p-2 text-[11.5px] leading-[16px]" data-testid="map-preview">{text.split('\n').slice(0, 40).join('\n')}</pre>;
}

function Details({ a, id, onExpand, expanded }: { a: Analysis; id: string; onExpand: (dir: string) => void; expanded: Set<string> }) {
  const m = modelOf(a);
  const { setTab } = useStore();
  const files = filesUnder(a, id);
  const set = new Set(files);
  const isDir = id.startsWith(DIR_PREFIX);
  const out = new Map<number, Confidence>();
  const inn = new Map<number, Confidence>();
  for (const i of files) {
    for (const e of m.out[i]) if (!set.has(e.to)) out.set(e.to, e.conf);
    for (const e of m.inn[i]) if (!set.has(e.from)) inn.set(e.from, e.conf);
  }
  const f = !isDir ? a.files[files[0]] : null;
  const unresolved = f ? a.unresolved.filter((u) => u.file === f.path) : [];
  const list = (title: string, items: Map<number, Confidence>, testId: string) => (
    <div>
      <div className="mb-1 text-xs font-semibold">{title} <span className="faint">({items.size})</span></div>
      {items.size === 0 ? <div className="faint text-xs">none</div> : (
        <ul className="max-h-40 space-y-0.5 overflow-auto text-xs" data-testid={testId}>
          {[...items].slice(0, 60).map(([i, conf]) => (
            <li key={i} className="flex items-center gap-1.5"><FileLink file={a.files[i].path} />{conf !== 'resolved' && <ConfBadge c={conf} />}</li>
          ))}
        </ul>
      )}
    </div>
  );
  return (
    <div className="space-y-3 p-3" data-testid="map-details">
      <div>
        <div className="mono break-all text-[13px] font-semibold">{isDir ? id.slice(DIR_PREFIX.length) + '/' : f?.path}</div>
        {f ? (
          <div className="mt-1 flex flex-wrap gap-1.5">
            <Badge>{f.lang}</Badge><Badge title={`role source: ${f.roleSource}`}>{ROLE_LABEL[f.role]}</Badge><ConfBadge c={f.roleConf} />
            <Badge>{fmtNum(f.loc)} lines</Badge><Badge title="Deepest analysis layer applied">L{f.level}</Badge>
            {f.maxComplexity > 0 && <Badge>max complexity {f.maxComplexity}</Badge>}
          </div>
        ) : (
          <div className="mt-1 text-xs muted">{fmtNum(files.length)} files · {fmtNum(files.reduce((s, i) => s + a.files[i].loc, 0))} lines</div>
        )}
      </div>
      <div className="flex flex-wrap gap-2">
        {isDir && <button className="btn" onClick={() => onExpand(id.slice(DIR_PREFIX.length))}>{expanded.has(id.slice(DIR_PREFIX.length)) ? 'Collapse' : 'Expand'}</button>}
        {f && <FileLink file={f.path} label="Open full source" className="!font-sans btn !no-underline" />}
        {f && <button className="btn" onClick={() => setTab('impact', { file: f.path })}>Impact</button>}
      </div>
      {f && <Preview path={f.path} />}
      {list('Depends on', out, 'map-deps')}
      {list('Depended on by', inn, 'map-dependents')}
      {unresolved.length > 0 && (
        <div>
          <div className="mb-1 text-xs font-semibold">Unresolved references <span className="faint">({unresolved.length})</span></div>
          <ul className="space-y-0.5 text-xs">{unresolved.slice(0, 12).map((u, i) => <li key={i}><FileLink file={u.file} line={u.line} label={`:${u.line}`} /> <span className="muted">{u.detail}</span></li>)}</ul>
        </div>
      )}
    </div>
  );
}

export function SystemMap() {
  const a = useStore((s) => s.analysis)!;
  const [filter, setFilter] = useState<MapFilter>({ hideTests: false, confs: new Set(CONFS) });
  const [expanded, setExpanded] = useState<Set<string>>(() => defaultExpanded(a, {}, MAX_NODES));
  const [selected, setSelected] = useState<string | null>(null);
  const [layout, setLayout] = useState<'fcose' | 'elk'>('fcose');
  const stamp = `${a.files.length}:${a.imports.length}`;
  useEffect(() => setExpanded(defaultExpanded(a, {}, MAX_NODES)), [stamp]); // eslint-disable-line react-hooks/exhaustive-deps

  const view = useMemo(() => buildMapView(a, expanded, filter, MAX_NODES), [a, stamp, expanded, filter]); // eslint-disable-line react-hooks/exhaustive-deps
  const elements = useMemo<ElementDefinition[]>(() => [
    ...view.nodes.map((n) => ({ data: { id: n.id, label: n.kind === 'dir' && !n.container ? `${n.label}  (${n.files})` : n.label, kind: n.kind, parent: n.parent } })),
    ...view.edges.map((e) => ({ data: { id: e.id, source: e.source, target: e.target, count: e.count, conf: e.conf, label: e.count > 1 ? String(e.count) : '' } })),
  ], [view]);

  const roles = useMemo(() => uniq(a.files.map((f) => f.role)).sort(), [a, stamp]); // eslint-disable-line react-hooks/exhaustive-deps
  const langs = useMemo(() => uniq(a.files.map((f) => f.lang)).sort(), [a, stamp]); // eslint-disable-line react-hooks/exhaustive-deps
  const toggle = (dir: string) => {
    const next = new Set(expanded);
    if (next.has(dir)) {
      for (const d of [...next]) if (d === dir || d.startsWith(dir + '/')) next.delete(d);
    } else {
      next.add(dir);
      let p = dirname(dir);
      while (p) { next.add(p); p = dirname(p); }
    }
    setExpanded(next);
  };
  const toggleIn = (key: 'roles' | 'langs', v: string) => {
    const s = new Set(filter[key] ?? []);
    if (s.has(v)) s.delete(v); else s.add(v);
    setFilter({ ...filter, [key]: s });
  };
  const toggleConf = (c: Confidence) => {
    const s = new Set(filter.confs);
    if (s.has(c)) s.delete(c); else s.add(c);
    setFilter({ ...filter, confs: s });
  };
  // Level of detail: zooming in on a collapsed cluster expands it (while the node budget allows).
  const onZoom = (cy: Core) => {
    if (cy.zoom() < 1.6) return;
    const ext = cy.extent();
    const cands = cy.nodes('[kind="dir"]').filter((n) => !n.isParent() && n.renderedWidth() > 150 && n.position('x') > ext.x1 && n.position('x') < ext.x2 && n.position('y') > ext.y1 && n.position('y') < ext.y2);
    if (cands.length === 0 || cands.length > 3) return;
    const dir = cands[0].id().slice(DIR_PREFIX.length);
    if (view.nodes.length + 12 < MAX_NODES && !expanded.has(dir)) toggle(dir);
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-[var(--line)] bg-[var(--bg2)] px-4 py-2 text-[13px]">
        <span className="font-semibold">System map</span>
        <span className="muted" data-testid="map-counts">{view.nodes.length} nodes · {view.edges.length} edges shown (max {MAX_NODES})</span>
        <div className="flex items-center gap-1">
          <span className="faint">Confidence</span>
          {CONFS.map((c) => (
            <label key={c} className="flex items-center gap-1"><input type="checkbox" data-testid={`conf-${c}`} checked={filter.confs?.has(c) ?? true} onChange={() => toggleConf(c)} />{c}</label>
          ))}
        </div>
        <label className="flex items-center gap-1">
          <span className="faint">Role</span>
          <select className="input" data-testid="role-filter" value="" onChange={(e) => e.target.value && toggleIn('roles', e.target.value)}>
            <option value="">{filter.roles?.size ? `${filter.roles.size} selected` : 'all'}</option>
            {roles.map((r) => <option key={r} value={r}>{filter.roles?.has(r) ? '✓ ' : ''}{ROLE_LABEL[r]}</option>)}
          </select>
        </label>
        <label className="flex items-center gap-1">
          <span className="faint">Language</span>
          <select className="input" data-testid="lang-filter" value="" onChange={(e) => e.target.value && toggleIn('langs', e.target.value)}>
            <option value="">{filter.langs?.size ? `${filter.langs.size} selected` : 'all'}</option>
            {langs.map((l) => <option key={l} value={l}>{filter.langs?.has(l) ? '✓ ' : ''}{l}</option>)}
          </select>
        </label>
        <label className="flex items-center gap-1"><input type="checkbox" checked={!!filter.hideTests} onChange={(e) => setFilter({ ...filter, hideTests: e.target.checked })} />hide tests</label>
        {(filter.roles?.size || filter.langs?.size) ? <button className="link" onClick={() => setFilter({ ...filter, roles: undefined, langs: undefined })}>clear filters</button> : null}
        <span className="ml-auto flex items-center gap-2">
          <select className="input" value={layout} onChange={(e) => setLayout(e.target.value as 'fcose' | 'elk')} title="Layout algorithm">
            <option value="fcose">Force layout</option>
            <option value="elk">Layered layout (ELK)</option>
          </select>
          <button className="btn" onClick={() => setExpanded(new Set(['', ...a.files.flatMap((f) => { const out: string[] = []; let d = dirname(f.path); while (d) { out.push(d); d = dirname(d); } return out; })]))} title="Expand as far as the node budget allows">Expand all</button>
          <button className="btn" onClick={() => setExpanded(defaultExpanded(a, {}, 0))}>Collapse all</button>
        </span>
      </div>
      {view.collapsed.length > 0 && (
        <div className="border-b border-[var(--line)] px-4 py-1 text-xs text-[var(--warn)]" data-testid="map-budget">
          {view.collapsed.length} director{view.collapsed.length === 1 ? 'y was' : 'ies were'} kept collapsed to stay under {MAX_NODES} nodes. Zoom in or double-click a cluster to expand it.
        </div>
      )}
      <div className="flex min-h-0 flex-1">
        <div className="min-w-0 flex-1">
          {view.nodes.length === 0 ? <div className="p-6 muted">No files match the current filters.</div> : (
            <Graph elements={elements} layout={layout} testId="map-canvas" onSelect={setSelected} onOpen={(id) => id.startsWith(DIR_PREFIX) && toggle(id.slice(DIR_PREFIX.length))} onZoom={onZoom} />
          )}
        </div>
        <div className="w-80 shrink-0 overflow-auto border-l border-[var(--line)]">
          {selected && !selected.includes('→') ? <Details a={a} id={selected} onExpand={toggle} expanded={expanded} /> : (
            <div className="space-y-2 p-3 text-[13px] muted">
              <p>Directories are clusters. <b>Double-click</b> a cluster (or zoom into it) to expand it; click any node for details.</p>
              <p>Solid edges are <b>resolved</b> (compiler-exact). Dashed grey edges are <b>heuristic</b>; dotted are <b>unresolved</b>.</p>
              <p>Edge labels show how many imports the edge aggregates.</p>
              {a.unresolved.length > 0 && <p>{a.unresolved.length} statically unresolvable reference(s) were recorded (dynamic imports, reflection, DI lookups…). Select a file to see its own.</p>}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
