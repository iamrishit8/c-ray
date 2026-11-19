// Shortest import path between two files (breadth-first over internal imports), for the System map
// path finder. Tries `from` → `to` first, then the reverse direction.
import type { Analysis, Confidence } from '../types';
import { worstConf } from '../util';

export interface ImportPath {
  files: string[];
  edges: { from: string; to: string; line: number; conf: Confidence }[];
  /** 'forward' = `from` imports its way to `to`; 'reverse' = `to` reaches `from`. */
  direction: 'forward' | 'reverse';
  conf: Confidence;
}

function bfs(a: Analysis, from: number, to: number): number[] | null {
  const out: number[][] = a.files.map(() => []);
  for (const e of a.imports) if (e.to >= 0 && e.to !== e.from) out[e.from].push(e.to);
  const prev = new Map<number, number>([[from, -1]]);
  const queue = [from];
  for (let q = 0; q < queue.length; q++) {
    const v = queue[q];
    if (v === to) break;
    for (const w of out[v]) {
      if (prev.has(w)) continue;
      prev.set(w, v);
      queue.push(w);
    }
  }
  if (!prev.has(to)) return null;
  const path: number[] = [];
  for (let v = to; v !== -1; v = prev.get(v)!) path.unshift(v);
  return path;
}

export function importPath(a: Analysis, from: string, to: string): ImportPath | null {
  const fi = a.files.findIndex((f) => f.path === from);
  const ti = a.files.findIndex((f) => f.path === to);
  if (fi < 0 || ti < 0 || fi === ti) return null;
  let direction: ImportPath['direction'] = 'forward';
  let p = bfs(a, fi, ti);
  if (!p) {
    p = bfs(a, ti, fi);
    direction = 'reverse';
  }
  if (!p) return null;
  const edges: ImportPath['edges'] = [];
  let conf: Confidence = 'resolved';
  for (let k = 0; k + 1 < p.length; k++) {
    // the best-confidence import between the two files carries the step
    const cands = a.imports.filter((e) => e.from === p![k] && e.to === p![k + 1]);
    const best = cands.find((e) => e.conf === 'resolved') ?? cands.find((e) => e.conf === 'heuristic') ?? cands[0];
    edges.push({ from: a.files[p[k]].path, to: a.files[p[k + 1]].path, line: best.line, conf: best.conf });
    conf = worstConf(conf, best.conf);
  }
  return { files: p.map((i) => a.files[i].path), edges, direction, conf };
}
