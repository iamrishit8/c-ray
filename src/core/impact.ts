// Impact analysis: what depends (transitively) on a file or symbol, which
// entry points and tests are affected, and a transparent risk score.
import { modelOf } from './model';
import type { Analysis, Confidence, EntryPoint } from './types';
import { worstConf } from './util';

export interface ImpactTarget {
  file?: string;
  symbol?: number;
}

export interface ImpactedFile {
  file: string;
  distance: number;
  conf: Confidence;
  /** Lines in this file that reference the target (distance 1 only). */
  sites: number[];
  test: boolean;
}

export interface ImpactedSymbol {
  sym: number;
  distance: number;
  conf: Confidence;
}

export interface Impact {
  label: string;
  kind: 'file' | 'symbol';
  files: ImpactedFile[];
  symbols: ImpactedSymbol[];
  entries: EntryPoint[];
  tests: string[];
  risk: { score: number; level: 'low' | 'medium' | 'high' | 'very high'; factors: { label: string; points: number }[] };
  /** True when part of the result relies on heuristic edges. */
  heuristic: boolean;
}

export function analyzeImpact(a: Analysis, target: ImpactTarget, maxDepth = 12): Impact | null {
  const m = modelOf(a);
  const files = new Map<number, ImpactedFile>();
  const symbols = new Map<number, ImpactedSymbol>();
  let label = '';
  let complexity = 0;
  let targetFile = -1;
  const touch = (fi: number, distance: number, conf: Confidence, site?: number) => {
    const f = a.files[fi];
    const cur = files.get(fi);
    if (!cur) files.set(fi, { file: f.path, distance, conf, sites: site !== undefined && distance === 1 ? [site] : [], test: f.test });
    else {
      if (distance < cur.distance) {
        cur.distance = distance;
        cur.conf = conf;
      }
      if (site !== undefined && distance === 1 && !cur.sites.includes(site) && cur.sites.length < 50) cur.sites.push(site);
    }
  };

  if (target.symbol !== undefined && a.symbols[target.symbol]) {
    const s = a.symbols[target.symbol];
    targetFile = s.file;
    label = `${m.symLabel(target.symbol)} (${m.path(s.file)}:${s.line})`;
    complexity = s.complexity;
    // reverse BFS over reference edges
    let frontier: { sym: number; conf: Confidence }[] = [{ sym: target.symbol, conf: 'resolved' }];
    const seen = new Set<number>([target.symbol]);
    for (let d = 1; d <= maxDepth && frontier.length; d++) {
      const next: typeof frontier = [];
      for (const cur of frontier) {
        for (const r of m.refsTo.get(cur.sym) ?? []) {
          const conf = worstConf(cur.conf, r.conf);
          if (r.file !== targetFile || r.from !== target.symbol) touch(r.file, d, conf, r.line);
          if (r.from >= 0 && !seen.has(r.from)) {
            seen.add(r.from);
            symbols.set(r.from, { sym: r.from, distance: d, conf });
            next.push({ sym: r.from, conf });
          }
        }
      }
      frontier = next;
    }
    files.delete(targetFile);
    // files that import a file containing an affected exported symbol are also potentially affected (distance + 1)
  } else if (target.file !== undefined && m.fileIdx.has(target.file)) {
    targetFile = m.fileIdx.get(target.file)!;
    label = target.file;
    complexity = a.files[targetFile].complexity;
    let frontier: { fi: number; conf: Confidence }[] = [{ fi: targetFile, conf: 'resolved' }];
    const seen = new Set<number>([targetFile]);
    for (let d = 1; d <= maxDepth && frontier.length; d++) {
      const next: typeof frontier = [];
      for (const cur of frontier) {
        for (const e of m.inn[cur.fi]) {
          const conf = worstConf(cur.conf, e.conf);
          touch(e.from, d, conf, e.line);
          if (!seen.has(e.from)) {
            seen.add(e.from);
            next.push({ fi: e.from, conf });
          }
        }
      }
      frontier = next;
    }
    // symbols in dependents that reference anything defined in the target file
    const own = new Set(m.symsByFile[targetFile]);
    for (const r of a.refs) if (own.has(r.to) && r.from >= 0 && a.symbols[r.from].file !== targetFile && !symbols.has(r.from)) symbols.set(r.from, { sym: r.from, distance: 1, conf: r.conf });
  } else return null;

  // affected entry points
  const affectedSyms = new Set(symbols.keys());
  if (target.symbol !== undefined) affectedSyms.add(target.symbol);
  const affectedFiles = new Set([...files.keys(), targetFile]);
  const entries: EntryPoint[] = [];
  const isFileTarget = target.symbol === undefined;
  const refSites = new Map<number, number[]>(); // file -> lines that reference affected symbols
  if (!isFileTarget) {
    for (const s of affectedSyms) for (const r of m.refsTo.get(s) ?? []) {
      const arr = refSites.get(r.file);
      if (arr) arr.push(r.line);
      else refSites.set(r.file, [r.line]);
    }
  }
  for (const e of a.entries) {
    const fi = m.fileIdx.get(e.file);
    if (fi === undefined) continue;
    let hit = false;
    if (isFileTarget) hit = affectedFiles.has(fi);
    else if (e.sym !== undefined) hit = affectedSyms.has(e.sym);
    else {
      const from = e.line;
      const to = e.endLine ?? (m.symbolAt(fi, e.line) >= 0 ? a.symbols[m.symbolAt(fi, e.line)].endLine : a.files[fi].loc);
      hit = (refSites.get(fi) ?? []).some((l) => l >= from && l <= to);
    }
    if (!hit && e.routeId) {
      const route = a.routes.find((r) => r.id === e.routeId);
      hit = !!route?.middleware.some((mw) => (mw.sym !== undefined && affectedSyms.has(mw.sym)) || (isFileTarget && mw.file !== undefined && affectedFiles.has(m.fileIdx.get(mw.file) ?? -1)));
    }
    if (hit) entries.push(e);
  }

  const list = [...files.values()].sort((x, y) => x.distance - y.distance || (x.file < y.file ? -1 : 1));
  const tests = list.filter((f) => f.test).map((f) => f.file);
  const nonTest = list.filter((f) => !f.test);
  const heuristic = list.some((f) => f.conf !== 'resolved');
  const factors: Impact['risk']['factors'] = [];
  const add = (label: string, points: number) => points > 0 && factors.push({ label, points: Math.round(points) });
  add(`${nonTest.length} dependent file(s), ${nonTest.filter((f) => f.distance === 1).length} direct`, Math.min(40, 12 * Math.log2(1 + nonTest.length)));
  add(`${entries.length} affected entry point(s)`, Math.min(25, 5 * entries.length));
  add(`complexity ${complexity} of the target itself`, Math.min(15, complexity / 2));
  add('no test file depends on it', tests.length === 0 && nonTest.length > 0 ? 15 : 0);
  add('part of the dependents were found heuristically (more may exist)', heuristic ? 5 : 0);
  const churn = a.git?.churn.find((c) => c.file === a.files[targetFile].path);
  if (churn) add(`changed in ${churn.commits} commit(s)`, Math.min(10, churn.commits / 2));
  const score = Math.min(100, factors.reduce((s, f) => s + f.points, 0));
  return {
    label, kind: isFileTarget ? 'file' : 'symbol', files: list,
    symbols: [...symbols.values()].sort((x, y) => x.distance - y.distance),
    entries, tests, heuristic,
    risk: { score, level: score < 25 ? 'low' : score < 50 ? 'medium' : score < 75 ? 'high' : 'very high', factors },
  };
}
