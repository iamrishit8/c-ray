import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Route as RouteIcon, X } from 'lucide-react';
import type { Core, ElementDefinition } from 'cytoscape';
import { buildMapView, defaultExpanded, DIR_PREFIX, filesUnder, type MapFilter } from '../core/mapview';
import { modelOf } from '../core/model';
import { ROLE_LABEL } from '../core/roles';
import type { Analysis, Confidence } from '../core/types';
import { dirname, fmtNum, uniq } from '../core/util';
import { useStore } from '../store/store';
import { worker } from '../workers/client';
import { importPath, type ImportPath } from '../core/viz/path';
import { Graph } from './Graph';
import { Badge, Chip, ConfBadge, FileLink, heat, langColors, PageHeader, RoleBadge, SERIES_OTHER, Skeleton } from './kit';

const MAX_NODES = 500;
/** Short role names for node subtitles ("service · 412 lines"). */
const ROLE_SHORT: Record<string, string> = { entry: 'entry', route: 'route', controller: 'controller', middleware: 'middleware', service: 'service', repository: 'repository', model: 'model', view: 'view', component: 'component', page: 'page', config: 'config', util: 'util', test: 'test', migration: 'migration', job: 'job', cli: 'cli', client: 'client', messaging: 'messaging', schema: 'schema', doc: 'doc', build: 'build', unknown: 'file' };
const CONFS: Confidence[] = ['resolved', 'heuristic', 'unresolved'];
type ColorBy = 'role' | 'lang' | 'complexity' | 'churn';
type SizeBy = 'none' | 'lines' | 'fanin';

/** The visible node that stands for a file: the file itself, or the collapsed folder it sits in. */
function visibleNodeOf(ids: Set<string>, path: string): string | null {
  if (ids.has('file:' + path)) return 'file:' + path;
  let d = dirname(path);
  while (d) {
    if (ids.has(DIR_PREFIX + d)) return DIR_PREFIX + d;
    d = dirname(d);
  }
  return null;
}
const ancestors = (path: string) => { const out: string[] = []; let d = dirname(path); while (d) { out.push(d); d = dirname(d); } return out; };

/** Pick two files and show the shortest import path between them, one step at a time. */
function PathFinder({ a, onPath, onClose }: { a: Analysis; onPath: (p: ImportPath | null, step: number) => void; onClose: () => void }) {
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [res, setRes] = useState<ImportPath | null | 'none'>(null);
  const [step, setStep] = useState(0);
  const go = (p: ImportPath | null | 'none', k: number) => {
    setRes(p);
    setStep(k);
    onPath(p && p !== 'none' ? p : null, k);
  };
  const find = () => go(importPath(a, from.trim(), to.trim()) ?? 'none', 0);
  const known = (p: string) => a.files.some((f) => f.path === p.trim());
  return (
    <div className="border-b border-[var(--line)] bg-[var(--bg2)] px-5 py-3 md:px-8 fade-in" data-testid="path-finder">
      <datalist id="map-files">{a.files.slice(0, 3000).map((f) => <option key={f.path} value={f.path} />)}</datalist>
      <form className="flex flex-wrap items-center gap-2 text-[13px]" onSubmit={(e) => { e.preventDefault(); find(); }}>
        <span className="label">Path from</span>
        <input className="input w-72 max-w-full" list="map-files" value={from} onChange={(e) => setFrom(e.target.value)} placeholder="src/server.js" aria-label="Start file" data-testid="path-from" />
        <span className="label">to</span>
        <input className="input w-72 max-w-full" list="map-files" value={to} onChange={(e) => setTo(e.target.value)} placeholder="src/models/User.js" aria-label="End file" data-testid="path-to" />
        <button className="btn btn-primary" type="submit" disabled={!known(from) || !known(to)} data-testid="path-find">Find path</button>
        <button className="btn btn-round !h-8 !w-8 ml-auto" type="button" onClick={() => { onPath(null, 0); onClose(); }} aria-label="Close path finder" title="Close path finder"><X aria-hidden="true" size={15} /></button>
      </form>
      {res === 'none' && <p className="mt-2 text-[13px] muted" data-testid="path-none">No import path connects these files in either direction.</p>}
      {res && res !== 'none' && (
        <div className="mt-2.5 flex flex-wrap items-center gap-2 text-[13px]" data-testid="path-result">
          <span className="muted">{res.edges.length} step{res.edges.length === 1 ? '' : 's'}{res.direction === 'reverse' ? ' (the second file imports its way to the first)' : ''}</span>
          <ConfBadge c={res.conf} />
          <button className="btn btn-icon" onClick={() => go(res, Math.max(0, step - 1))} disabled={step === 0} aria-label="Previous step" data-testid="path-prev"><ChevronLeft aria-hidden="true" size={15} /></button>
          <span className="tnum" data-testid="path-step">{step + 1} / {res.edges.length}</span>
          <button className="btn btn-icon" onClick={() => go(res, Math.min(res.edges.length - 1, step + 1))} disabled={step >= res.edges.length - 1} aria-label="Next step" data-testid="path-next"><ChevronRight aria-hidden="true" size={15} /></button>
          {res.edges[step] && <span className="flex flex-wrap items-center gap-1.5"><FileLink file={res.edges[step].from} line={res.edges[step].line} /><span className="faint">imports</span><FileLink file={res.edges[step].to} /></span>}
        </div>
      )}
    </div>
  );
}

function Preview({ path }: { path: string }) {
  const [text, setText] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    setText(null);
    worker.call('source', { path }).then((r) => live && setText(r.text ?? '')).catch(() => live && setText(''));
    return () => { live = false; };
  }, [path]);
  if (text === null) return <Skeleton rows={5} />;
  if (!text) return <div className="faint text-xs">Source preview not available.</div>;
  return <pre className="max-h-56 overflow-auto rounded-[var(--r-sm)] border border-[var(--line)] bg-[var(--bg)] p-2.5 text-[11.5px] leading-[16px]" data-testid="map-preview">{text.split('\n').slice(0, 40).join('\n')}</pre>;
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
      <div className="label mb-1.5">{title} <span className="tnum">({items.size})</span></div>
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
    <div className="space-y-4 p-4" data-testid="map-details">
      <div>
        <div className="mono break-all text-[13px] font-medium">{isDir ? id.slice(DIR_PREFIX.length) + '/' : f?.path}</div>
        {f ? (
          <div className="mt-1 flex flex-wrap gap-1.5">
            <RoleBadge role={f.role} title={`role source: ${f.roleSource}`}>{ROLE_LABEL[f.role]}</RoleBadge><ConfBadge c={f.roleConf} /><Badge>{f.lang}</Badge>
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
          <div className="label mb-1.5">Unresolved references <span className="faint">({unresolved.length})</span></div>
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
  const [colorBy, setColorBy] = useState<ColorBy>('role');
  const [sizeBy, setSizeBy] = useState<SizeBy>('none');
  const [finder, setFinder] = useState(false);
  const [path, setPath] = useState<{ p: ImportPath; step: number } | null>(null);
  const [pulse, setPulse] = useState<{ id: string; key: number } | null>(null);
  const focus = useStore((s) => s.focus);
  const pulseKey = useRef(0);
  const stamp = `${a.files.length}:${a.imports.length}`;
  useEffect(() => setExpanded(defaultExpanded(a, {}, MAX_NODES)), [stamp]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!focus?.file) return;
    setExpanded((prev) => new Set([...prev, ...ancestors(focus.file!)]));
    setSelected('file:' + focus.file);
  }, [focus]);
  const view = useMemo(() => buildMapView(a, expanded, filter, MAX_NODES), [a, stamp, expanded, filter]); // eslint-disable-line react-hooks/exhaustive-deps
  const ids = useMemo(() => new Set(view.nodes.map((n) => n.id)), [view]);
  useEffect(() => {
    if (!focus?.file) return;
    const id = visibleNodeOf(ids, focus.file);
    if (id) setPulse({ id, key: ++pulseKey.current });
  }, [focus, ids]);

  // colour by / size by
  const churn = useMemo(() => new Map((a.git?.churn ?? []).map((c) => [c.file, c.commits])), [a.git]);
  const lang = useMemo(() => langColors(a.l0.languages), [a.l0.languages]);
  const metric = (n: (typeof view.nodes)[number]): { cx: number; ch: number } => {
    const files = n.kind === 'file' ? [n.file!] : filesUnder(a, n.id);
    let cx = 0;
    let ch = 0;
    for (const i of files) {
      cx = Math.max(cx, a.files[i].complexity);
      ch = Math.max(ch, churn.get(a.files[i].path) ?? 0);
    }
    return { cx, ch };
  };
  const fanIn = useMemo(() => {
    const m = new Map<string, number>();
    for (const e of view.edges) m.set(e.target, (m.get(e.target) ?? 0) + e.count);
    return m;
  }, [view]);
  const elements = useMemo<ElementDefinition[]>(() => {
    const leaf = view.nodes.filter((n) => !n.container);
    const metrics = new Map(colorBy === 'complexity' || colorBy === 'churn' ? leaf.map((n) => [n.id, metric(n)]) : []);
    const maxCx = Math.max(1, ...[...metrics.values()].map((m) => m.cx));
    const maxCh = Math.max(1, ...[...metrics.values()].map((m) => m.ch));
    const maxLoc = Math.max(1, ...leaf.map((n) => n.loc));
    const maxFan = Math.max(1, ...leaf.map((n) => fanIn.get(n.id) ?? 0));
    return [
      ...view.nodes.map((n) => {
        const d: Record<string, unknown> = {
          id: n.id, label: n.label, kind: n.kind, parent: n.parent, role: colorBy === 'role' ? n.role : undefined,
          sub: n.container ? undefined : n.kind === 'dir' ? `${fmtNum(n.files)} files · ${fmtNum(n.loc)} lines` : `${ROLE_SHORT[n.role ?? 'unknown']} · ${fmtNum(n.loc)} lines`,
        };
        if (!n.container) {
          if (colorBy === 'lang' && n.lang) d.dotColor = lang(n.lang);
          if (colorBy === 'lang' && !n.lang) d.dotColor = SERIES_OTHER;
          if (colorBy === 'complexity') d.heat = Math.sqrt(metrics.get(n.id)!.cx / maxCx);
          if (colorBy === 'churn') d.heat = Math.sqrt(metrics.get(n.id)!.ch / maxCh);
          if (sizeBy === 'lines') d.pad = Math.round(8 + 22 * Math.sqrt(n.loc / maxLoc));
          if (sizeBy === 'fanin') d.pad = Math.round(8 + 22 * Math.sqrt((fanIn.get(n.id) ?? 0) / maxFan));
        }
        return { data: d };
      }),
      ...view.edges.map((e) => ({ data: { id: e.id, source: e.source, target: e.target, count: e.count, conf: e.conf, label: e.count > 1 ? String(e.count) : '' } })),
    ];
  }, [view, colorBy, sizeBy, fanIn, lang]); // eslint-disable-line react-hooks/exhaustive-deps

  // path finder: make its files visible, then highlight the path and the current step
  const onPath = (p: ImportPath | null, step: number) => {
    setPath(p ? { p, step } : null);
    if (p) setExpanded((prev) => new Set([...prev, ...p.files.flatMap(ancestors)]));
  };
  const highlight = useMemo(() => {
    if (!path) return null;
    const nodes = path.p.files.map((f) => visibleNodeOf(ids, f)).filter((x): x is string => !!x);
    const edgeIds = new Set(view.edges.map((e) => e.id));
    const edges: string[] = [];
    path.p.edges.forEach((e) => {
      // path edges always run importer → imported, whichever way the path was asked for
      const s = visibleNodeOf(ids, e.from);
      const t = visibleNodeOf(ids, e.to);
      if (s && t && edgeIds.has(s + '→' + t)) edges.push(s + '→' + t);
    });
    const cur = path.p.edges[path.step];
    const ce = cur && visibleNodeOf(ids, cur.from) + '→' + visibleNodeOf(ids, cur.to);
    return { nodes, edges, current: cur ? visibleNodeOf(ids, cur.to) ?? undefined : undefined, edge: ce && edgeIds.has(ce) ? ce : undefined };
  }, [path, ids, view]);
  const toMermaid = () => {
    const id = new Map(view.nodes.filter((n) => !n.container).map((n, i) => [n.id, `n${i}`]));
    const esc = (t: string) => t.replace(/["<>]/g, '');
    const lines = ['flowchart LR', ...[...id].map(([k, v]) => `  ${v}["${esc(view.nodes.find((n) => n.id === k)!.label)}"]`)];
    for (const e of view.edges) if (id.has(e.source) && id.has(e.target)) lines.push(`  ${id.get(e.source)} ${e.conf === 'resolved' ? '-->' : '-.->'}${e.count > 1 ? `|${e.count}|` : ''} ${id.get(e.target)}`);
    return lines.join('\n');
  };
  const legend = colorBy === 'lang'
    ? [...a.l0.languages].sort((x, y) => y.loc - x.loc).slice(0, 6).map((l) => ({ label: l.lang, color: lang(l.lang), fill: true }))
    : colorBy === 'complexity' || colorBy === 'churn'
      ? [{ label: `low ${colorBy}`, color: heat(0.1), fill: true }, { label: `high ${colorBy}`, color: heat(1), fill: true }]
      : undefined;

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
      <div className="border-b border-[var(--line)] px-5 pb-3.5 pt-5 md:px-8">
        <PageHeader
          title="System map"
          intro="How the code is wired: folders, files and the imports between them. Click a node to focus its neighbourhood; double-click a folder to open it."
          actions={
            <>
              <select className="input" value={layout} onChange={(e) => setLayout(e.target.value as 'fcose' | 'elk')} title="Layout algorithm" aria-label="Layout algorithm">
                <option value="fcose">Force layout</option>
                <option value="elk">Layered layout (ELK)</option>
              </select>
              <button className="btn" onClick={() => setExpanded(new Set(['', ...a.files.flatMap((f) => { const out: string[] = []; let d = dirname(f.path); while (d) { out.push(d); d = dirname(d); } return out; })]))} title="Expand as far as the node budget allows">Expand all</button>
              <button className="btn" onClick={() => setExpanded(defaultExpanded(a, {}, 0))}>Collapse all</button>
              <button className={`btn ${finder ? 'is-selected' : ''}`} onClick={() => { setFinder(!finder); if (finder) setPath(null); }} aria-pressed={finder} data-testid="path-toggle"><RouteIcon aria-hidden="true" size={14} />Path</button>
            </>
          }
        />
        <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 text-[13px]">
          <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Edge confidence">
            <span className="label mr-1">Edges</span>
            {CONFS.map((c) => (
              <Chip key={c} on={filter.confs?.has(c) ?? true} onClick={() => toggleConf(c)} testId={`conf-${c}`}>{c}</Chip>
            ))}
          </div>
          <label className="flex items-center gap-1.5">
            <span className="label">Role</span>
            <select className="input max-w-44" data-testid="role-filter" value="" onChange={(e) => e.target.value && toggleIn('roles', e.target.value)}>
              <option value="">{filter.roles?.size ? `${filter.roles.size} selected` : 'all'}</option>
              {roles.map((r) => <option key={r} value={r}>{filter.roles?.has(r) ? '✓ ' : ''}{ROLE_LABEL[r]}</option>)}
            </select>
          </label>
          <label className="flex items-center gap-1.5">
            <span className="label">Language</span>
            <select className="input max-w-36" data-testid="lang-filter" value="" onChange={(e) => e.target.value && toggleIn('langs', e.target.value)}>
              <option value="">{filter.langs?.size ? `${filter.langs.size} selected` : 'all'}</option>
              {langs.map((l) => <option key={l} value={l}>{filter.langs?.has(l) ? '✓ ' : ''}{l}</option>)}
            </select>
          </label>
          <Chip on={!!filter.hideTests} onClick={() => setFilter({ ...filter, hideTests: !filter.hideTests })} testId="hide-tests">hide tests</Chip>
          <label className="flex items-center gap-1.5">
            <span className="label">Colour</span>
            <select className="input" data-testid="map-color-by" value={colorBy} onChange={(e) => setColorBy(e.target.value as ColorBy)}>
              <option value="role">role</option><option value="lang">language</option><option value="complexity">complexity</option><option value="churn" disabled={!a.git}>churn{a.git ? '' : ' (needs .git)'}</option>
            </select>
          </label>
          <label className="flex items-center gap-1.5">
            <span className="label">Size</span>
            <select className="input" data-testid="map-size-by" value={sizeBy} onChange={(e) => setSizeBy(e.target.value as SizeBy)}>
              <option value="none">same</option><option value="lines">lines</option><option value="fanin">fan-in</option>
            </select>
          </label>
          {(filter.roles?.size || filter.langs?.size) ? <button className="link" onClick={() => setFilter({ ...filter, roles: undefined, langs: undefined })}>clear filters</button> : null}
          <span className="tnum ml-auto text-[12.5px] faint" data-testid="map-counts">{view.nodes.length} nodes · {view.edges.length} edges shown (max {MAX_NODES})</span>
        </div>
      </div>
      {finder && <PathFinder a={a} onPath={onPath} onClose={() => setFinder(false)} />}
      {view.collapsed.length > 0 && (
        <div className="border-b border-[var(--line)] px-5 py-1.5 text-xs text-[var(--warn)] md:px-8" data-testid="map-budget">
          {view.collapsed.length} director{view.collapsed.length === 1 ? 'y was' : 'ies were'} kept collapsed to stay under {MAX_NODES} nodes. Zoom in or double-click a cluster to expand it.
        </div>
      )}
      <div className="flex min-h-0 flex-1">
        <div className="min-w-0 flex-1">
          {view.nodes.length === 0 ? <div className="p-6 muted">No files match the current filters.</div> : (
            <Graph elements={elements} layout={layout} testId="map-canvas" onSelect={setSelected} onOpen={(id) => id.startsWith(DIR_PREFIX) && toggle(id.slice(DIR_PREFIX.length))} onZoom={onZoom}
              highlight={highlight} pulse={pulse} exportName={`${a.name}-system-map`} toMermaid={toMermaid} hideRoles={colorBy !== 'role'} legend={legend} />
          )}
        </div>
        <div className="w-80 shrink-0 overflow-auto border-l border-[var(--line)] bg-[var(--bg2)] max-[1100px]:w-64 max-[760px]:hidden">
          {selected && !selected.includes('→') ? <Details a={a} id={selected} onExpand={toggle} expanded={expanded} /> : (
            <div className="space-y-2 p-3 text-[13px] muted">
              <div className="label">How to read it</div>
              <p>Directories are clusters. <b className="text-[var(--fg)]">Double-click</b> a cluster (or zoom into it) to expand it. Click a node to focus it: its neighbours and edges light up, the rest fades.</p>
              <p>Solid edges are <b className="text-[var(--fg)]">resolved</b> (compiler-exact), dashed are <b className="text-[var(--fg)]">heuristic</b>, dotted are <b className="text-[var(--fg)]">unresolved</b>. The number on an edge is how many imports it aggregates.</p>
              {a.unresolved.length > 0 && <p>{a.unresolved.length} statically unresolvable reference(s) were recorded (dynamic imports, reflection, DI lookups…). Select a file to see its own.</p>}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
