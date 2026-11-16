// Level-of-detail view model for the system map: directories are clusters that
// can be expanded; the visible graph never exceeds a node budget.
import type { Analysis, Confidence, Role } from './types';
import { dirname, worstConf } from './util';

export interface MapNode {
  id: string;
  label: string;
  kind: 'dir' | 'file';
  /** Enclosing expanded directory (compound parent), if any. */
  parent?: string;
  /** True for an expanded directory acting as a container. */
  container?: boolean;
  files: number;
  loc: number;
  role?: Role;
  lang?: string;
  /** Index into Analysis.files for file nodes. */
  file?: number;
}

export interface MapEdge {
  id: string;
  source: string;
  target: string;
  count: number;
  conf: Confidence;
}

export interface MapFilter {
  roles?: Set<string>;
  langs?: Set<string>;
  confs?: Set<Confidence>;
  hideTests?: boolean;
}

export interface MapView {
  nodes: MapNode[];
  edges: MapEdge[];
  /** Directories that had to be re-collapsed to respect the node budget. */
  collapsed: string[];
  visibleFiles: number;
}

export const DIR_PREFIX = 'dir:';
const ROOT = '';

interface DirInfo {
  dirs: Set<string>;
  files: number[];
  total: number;
  loc: number;
}

function buildTree(a: Analysis, keep: (i: number) => boolean): Map<string, DirInfo> {
  const tree = new Map<string, DirInfo>();
  const get = (d: string) => {
    let n = tree.get(d);
    if (!n) {
      n = { dirs: new Set(), files: [], total: 0, loc: 0 };
      tree.set(d, n);
    }
    return n;
  };
  get(ROOT);
  a.files.forEach((f, i) => {
    if (!keep(i)) return;
    let d = dirname(f.path);
    get(d).files.push(i);
    for (;;) {
      const n = get(d);
      n.total++;
      n.loc += f.loc;
      if (d === ROOT) break;
      const p = dirname(d);
      get(p).dirs.add(d);
      d = p;
    }
  });
  return tree;
}

/** Sensible starting state: open the single-child chain from the root; open everything for small projects. */
export function defaultExpanded(a: Analysis, filter: MapFilter = {}, maxNodes = 500): Set<string> {
  const tree = buildTree(a, makeKeep(a, filter));
  const out = new Set<string>([ROOT]);
  if ((tree.get(ROOT)?.total ?? 0) + tree.size <= Math.min(80, maxNodes)) {
    for (const d of tree.keys()) out.add(d);
    return out;
  }
  let cur = ROOT;
  for (;;) {
    const n = tree.get(cur)!;
    if (n.dirs.size === 1 && n.files.length === 0) {
      cur = [...n.dirs][0];
      out.add(cur);
    } else break;
  }
  return out;
}

function makeKeep(a: Analysis, filter: MapFilter): (i: number) => boolean {
  return (i) => {
    const f = a.files[i];
    if (filter.hideTests && f.test) return false;
    if (filter.roles?.size && !filter.roles.has(f.role)) return false;
    if (filter.langs?.size && !filter.langs.has(f.lang)) return false;
    return true;
  };
}

export function buildMapView(a: Analysis, expandedIn: Set<string>, filter: MapFilter = {}, maxNodes = 500): MapView {
  const keep = makeKeep(a, filter);
  const tree = buildTree(a, keep);
  const expanded = new Set([...expandedIn].filter((d) => tree.has(d)));
  expanded.add(ROOT);
  const collapsed: string[] = [];

  const count = (): number => {
    let n = 0;
    const walk = (d: string) => {
      const info = tree.get(d)!;
      n += info.files.length;
      for (const sub of info.dirs) {
        n++;
        if (expanded.has(sub)) walk(sub);
      }
    };
    walk(ROOT);
    return n;
  };
  // Enforce the budget by re-collapsing the largest expanded directories, deepest first.
  while (count() > maxNodes) {
    const cands = [...expanded].filter((d) => d !== ROOT && isReachable(d, expanded));
    if (cands.length === 0) break;
    cands.sort((x, y) => y.split('/').length - x.split('/').length || childCount(tree.get(y)!) - childCount(tree.get(x)!));
    const victim = cands[0];
    expanded.delete(victim);
    collapsed.push(victim);
  }

  const nodes: MapNode[] = [];
  const visibleOf = new Map<number, string>(); // file index -> visible node id
  const assign = (d: string, id: string) => {
    const info = tree.get(d)!;
    for (const i of info.files) visibleOf.set(i, id);
    for (const sub of info.dirs) assign(sub, id);
  };
  const label = (d: string, parent: string) => (parent && d.startsWith(parent + '/') ? d.slice(parent.length + 1) : d) + '/';
  const walk = (d: string, parentId: string | undefined, parentDir: string) => {
    const info = tree.get(d)!;
    for (const sub of [...info.dirs].sort()) {
      const si = tree.get(sub)!;
      const id = DIR_PREFIX + sub;
      if (expanded.has(sub)) {
        // transparent chain link: a directory holding exactly one sub-directory and no files gets no box of its own
        if (si.files.length === 0 && si.dirs.size === 1) {
          walk(sub, parentId, parentDir);
          continue;
        }
        nodes.push({ id, label: label(sub, parentDir), kind: 'dir', parent: parentId, container: true, files: si.total, loc: si.loc });
        walk(sub, id, sub);
      } else {
        nodes.push({ id, label: label(sub, parentDir), kind: 'dir', parent: parentId, files: si.total, loc: si.loc });
        assign(sub, id);
      }
    }
    for (const i of info.files) {
      const f = a.files[i];
      const id = 'file:' + f.path;
      nodes.push({ id, label: f.path.slice(f.path.lastIndexOf('/') + 1), kind: 'file', parent: parentId, files: 1, loc: f.loc, role: f.role, lang: f.lang, file: i });
      visibleOf.set(i, id);
    }
  };
  walk(ROOT, undefined, ROOT);

  const agg = new Map<string, MapEdge>();
  for (const e of a.imports) {
    if (e.to < 0 || e.to === e.from) continue;
    if (filter.confs?.size && !filter.confs.has(e.conf)) continue;
    const s = visibleOf.get(e.from);
    const t = visibleOf.get(e.to);
    if (!s || !t || s === t) continue;
    const id = s + '→' + t;
    const cur = agg.get(id);
    if (cur) {
      cur.count++;
      cur.conf = worstConf(cur.conf, e.conf);
    } else agg.set(id, { id, source: s, target: t, count: 1, conf: e.conf });
  }
  return { nodes, edges: [...agg.values()], collapsed, visibleFiles: nodes.filter((n) => n.kind === 'file').length };
}

function childCount(d: DirInfo): number {
  return d.dirs.size + d.files.length;
}

function isReachable(d: string, expanded: Set<string>): boolean {
  let p = dirname(d);
  while (p !== ROOT) {
    if (!expanded.has(p)) return false;
    p = dirname(p);
  }
  return true;
}

/** Files (indexes) represented by a visible node. */
export function filesUnder(a: Analysis, nodeId: string): number[] {
  if (nodeId.startsWith('file:')) {
    const i = a.files.findIndex((f) => f.path === nodeId.slice(5));
    return i >= 0 ? [i] : [];
  }
  const dir = nodeId.slice(DIR_PREFIX.length);
  const out: number[] = [];
  a.files.forEach((f, i) => {
    if (f.path.startsWith(dir + '/')) out.push(i);
  });
  return out;
}
