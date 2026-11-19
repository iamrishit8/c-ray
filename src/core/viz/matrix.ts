// Dependency structure matrix (DSM): module × module import counts, ordered so that importers come
// before what they import (layers read top-down) and cycles stay adjacent. Pure, bounded.
import type { Analysis, Confidence, Role } from '../types';
import { dirname, worstConf } from '../util';

export interface DsmModule {
  /** Directory key (or file path at file level). */
  id: string;
  label: string;
  files: number[];
  /** 0 = entry/HTTP/UI, 1 = services, 2 = integrations, 3 = data, 4 = config/other. */
  layer: number;
}

export interface DsmEdge { from: string; to: string; line: number; conf: Confidence }

export interface DsmCell {
  /** Row imports column. */
  row: number;
  col: number;
  count: number;
  conf: Confidence;
  /** Row and column are in the same strongly connected group (an import loop between modules). */
  cycle: boolean;
  /** A layering violation (deps.violations) runs from the row module to the column module. */
  violation: boolean;
  /** The imports behind the cell (at most `maxEdgesPerCell`). */
  edges: DsmEdge[];
}

export interface Dsm {
  modules: DsmModule[];
  cells: DsmCell[];
  /** 'file' when every module is a single file, otherwise the directory depth used for grouping. */
  level: 'file' | number;
  /** Files that were folded into "(other)" because even depth 1 had too many modules. */
  folded: number;
}

const LAYER: Record<Role, number> = {
  entry: 0, route: 0, controller: 0, middleware: 0, page: 0, view: 0, component: 0, cli: 0,
  service: 1, util: 1, job: 1,
  client: 2, messaging: 2,
  model: 3, repository: 3, schema: 3, migration: 3,
  config: 4, build: 4, doc: 4, unknown: 4, test: 4,
};

export interface DsmOptions {
  maxModules?: number;
  maxEdgesPerCell?: number;
  includeTests?: boolean;
}

function keyAt(path: string, depth: number): string {
  const d = dirname(path);
  if (!d) return '';
  return d.split('/').slice(0, depth).join('/');
}

export function buildDsm(a: Analysis, opts: DsmOptions = {}): Dsm {
  const maxModules = opts.maxModules ?? 40;
  const maxEdges = opts.maxEdgesPerCell ?? 50;
  const edges = a.imports.filter((e) => e.to >= 0 && e.to !== e.from && !e.typeOnly && (opts.includeTests || (!a.files[e.from].test && !a.files[e.to].test)));
  const used = [...new Set(edges.flatMap((e) => [e.from, e.to]))].sort((x, y) => (a.files[x].path < a.files[y].path ? -1 : 1));
  if (used.length === 0) return { modules: [], cells: [], level: 'file', folded: 0 };

  // the finest grouping that fits: single files, else the deepest directory depth with ≤ maxModules groups
  let level: Dsm['level'] = 'file';
  let keyOf = (i: number) => a.files[i].path;
  if (used.length > maxModules) {
    const maxDepth = Math.max(...used.map((i) => a.files[i].path.split('/').length - 1));
    let depth = 1;
    for (let d = maxDepth; d >= 1; d--) {
      if (new Set(used.map((i) => keyAt(a.files[i].path, d))).size <= maxModules) {
        depth = d;
        break;
      }
    }
    level = depth;
    keyOf = (i: number) => keyAt(a.files[i].path, depth);
  }
  const groups = new Map<string, number[]>();
  for (const i of used) {
    const k = keyOf(i);
    const g = groups.get(k);
    if (g) g.push(i);
    else groups.set(k, [i]);
  }
  let folded = 0;
  if (groups.size > maxModules) {
    const keep = [...groups].sort((x, y) => y[1].length - x[1].length).slice(0, maxModules - 1).map(([k]) => k);
    const other: number[] = [];
    for (const [k, fs] of [...groups]) {
      if (keep.includes(k)) continue;
      other.push(...fs);
      groups.delete(k);
    }
    folded = other.length;
    groups.set('\u0000other', other);
  }

  const modules: DsmModule[] = [...groups].map(([id, files]) => {
    const layers = files.map((i) => LAYER[a.files[i].role]);
    // majority layer; ties go to the upper layer
    const counts = new Map<number, number>();
    for (const l of layers) counts.set(l, (counts.get(l) ?? 0) + 1);
    const layer = [...counts].sort((x, y) => y[1] - x[1] || x[0] - y[0])[0][0];
    const label = id === '\u0000other' ? '(other)' : level === 'file' ? id : id ? id + '/' : '(root)';
    return { id, label, files, layer };
  });
  const modOfFile = new Map<number, number>();
  modules.forEach((m, k) => m.files.forEach((i) => modOfFile.set(i, k)));

  // aggregate module edges
  const agg = new Map<string, { row: number; col: number; count: number; conf: Confidence; edges: DsmEdge[] }>();
  for (const e of edges) {
    const row = modOfFile.get(e.from)!;
    const col = modOfFile.get(e.to)!;
    const k = `${row}:${col}`;
    let c = agg.get(k);
    if (!c) {
      c = { row, col, count: 0, conf: 'resolved', edges: [] };
      agg.set(k, c);
    }
    c.count++;
    c.conf = worstConf(c.conf, e.conf);
    if (c.edges.length < maxEdges) c.edges.push({ from: a.files[e.from].path, to: a.files[e.to].path, line: e.line, conf: e.conf });
  }

  // strongly connected components (Tarjan, iterative) over module → module
  const n = modules.length;
  const adj: number[][] = modules.map(() => []);
  for (const c of agg.values()) if (c.row !== c.col) adj[c.row].push(c.col);
  const comp = sccs(n, adj);

  // order: topological over the component DAG (importers first), ties by layer then label
  const order = topoOrder(n, adj, comp, (k) => [modules[k].layer, modules[k].label]);
  const pos = new Map<number, number>();
  order.forEach((k, p) => pos.set(k, p));

  // layering violations → (module of file, module of target)
  const viol = new Set<string>();
  const entityFile = new Map(a.schema.entities.map((e) => [e.name, e.file]));
  const idxOf = new Map(a.files.map((f, i) => [f.path, i]));
  for (const v of a.deps.violations) {
    const from = idxOf.get(v.file);
    const targetPath = v.target ? (idxOf.has(v.target) ? v.target : entityFile.get(v.target)) : undefined;
    const to = targetPath !== undefined ? idxOf.get(targetPath) : undefined;
    if (from === undefined || to === undefined) continue;
    const r = modOfFile.get(from);
    const c = modOfFile.get(to);
    if (r !== undefined && c !== undefined) viol.add(`${r}:${c}`);
  }

  const cells: DsmCell[] = [...agg.values()].map((c) => ({
    row: pos.get(c.row)!, col: pos.get(c.col)!, count: c.count, conf: c.conf, edges: c.edges,
    cycle: c.row !== c.col && comp[c.row] === comp[c.col],
    violation: viol.has(`${c.row}:${c.col}`),
  }));
  cells.sort((x, y) => x.row - y.row || x.col - y.col);
  return { modules: order.map((k) => modules[k]), cells, level, folded };
}

function sccs(n: number, adj: number[][]): number[] {
  const index = new Array<number>(n).fill(-1);
  const low = new Array<number>(n).fill(0);
  const onStack = new Array<boolean>(n).fill(false);
  const comp = new Array<number>(n).fill(-1);
  const stack: number[] = [];
  let next = 0;
  let c = 0;
  for (let s = 0; s < n; s++) {
    if (index[s] >= 0) continue;
    const work: [number, number][] = [[s, 0]];
    while (work.length) {
      const top = work[work.length - 1];
      const [v, i] = top;
      if (i === 0) {
        index[v] = low[v] = next++;
        stack.push(v);
        onStack[v] = true;
      }
      if (i < adj[v].length) {
        top[1]++;
        const w = adj[v][i];
        if (index[w] < 0) work.push([w, 0]);
        else if (onStack[w]) low[v] = Math.min(low[v], index[w]);
        continue;
      }
      work.pop();
      if (work.length) {
        const p = work[work.length - 1][0];
        low[p] = Math.min(low[p], low[v]);
      }
      if (low[v] === index[v]) {
        let w: number;
        do {
          w = stack.pop()!;
          onStack[w] = false;
          comp[w] = c;
        } while (w !== v);
        c++;
      }
    }
  }
  return comp;
}

type SortKey = [number, string];
const cmpKey = (x: SortKey, y: SortKey) => x[0] - y[0] || (x[1] < y[1] ? -1 : x[1] > y[1] ? 1 : 0);

function topoOrder(n: number, adj: number[][], comp: number[], key: (k: number) => SortKey): number[] {
  const nc = Math.max(-1, ...comp) + 1;
  const members: number[][] = Array.from({ length: nc }, () => []);
  comp.forEach((c, k) => members[c].push(k));
  members.forEach((m) => m.sort((x, y) => cmpKey(key(x), key(y))));
  const indeg = new Array<number>(nc).fill(0);
  const cadj: Set<number>[] = Array.from({ length: nc }, () => new Set());
  for (let v = 0; v < n; v++) for (const w of adj[v]) if (comp[v] !== comp[w] && !cadj[comp[v]].has(comp[w])) {
    cadj[comp[v]].add(comp[w]);
    indeg[comp[w]]++;
  }
  const ckey = (c: number) => key(members[c][0]);
  const ready = members.map((_, c) => c).filter((c) => indeg[c] === 0);
  const out: number[] = [];
  while (ready.length) {
    ready.sort((x, y) => cmpKey(ckey(x), ckey(y)));
    const c = ready.shift()!;
    out.push(...members[c]);
    for (const d of cadj[c]) if (--indeg[d] === 0) ready.push(d);
  }
  return out;
}
