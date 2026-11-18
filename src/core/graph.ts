// Graph stages: collect per-file graphs (L1 heuristic, L2 exact) and assemble
// them into the global symbol table, import edges and reference edges.
import { isTsJs } from './l0/languages';
import type { FileGraph, L2Input, L2Result } from './l2/tsgraph';
import type { ResolverConfig } from './resolve-js';
import { workspacePackages } from './packages';
export { workspacePackages };
import type { Stage, StageContext } from './pipeline';
import type { ImportEdge, PR, RefEdge, SymbolDef } from './types';
import { buildL1Graphs } from './l1/resolve';
import { basename } from './util';

export type RunL2 = (input: L2Input) => Promise<L2Result>;

export function tsConfigs(ctx: StageContext): ResolverConfig[] {
  return ctx.units.filter((u) => /^(tsconfig.*|jsconfig)\.json$/.test(basename(u.path))).map((u) => ({ path: u.path, text: u.text }));
}

export function l2Stage(runL2: RunL2): Stage {
  return {
    name: 'Resolving TypeScript/JavaScript (L2)',
    phase: 'graph',
    async run(ctx) {
      const { a, opts } = ctx;
      let cands = ctx.units.filter((u) => isTsJs(u.path));
      if (cands.length === 0) return;
      if (cands.length > opts.maxL2Files) {
        const fileInfo = new Map(a.files.map((f) => [f.path, f]));
        cands = [...cands].sort((x, y) => Number(fileInfo.get(x.path)?.test) - Number(fileInfo.get(y.path)?.test) || x.path.split('/').length - y.path.split('/').length).slice(0, opts.maxL2Files);
        a.notices.push(`Exact TypeScript/JavaScript resolution (L2) was limited to ${opts.maxL2Files} of ${ctx.units.filter((u) => isTsJs(u.path)).length} files; the rest use heuristic (L1) edges.`);
      }
      const res = await runL2({
        files: cands.map((u) => ({ path: u.path, text: u.text })),
        allPaths: ctx.units.map((u) => u.path),
        configs: tsConfigs(ctx),
        packages: workspacePackages(ctx),
        libs: {},
        maxMs: 120_000,
      });
      for (const [path, g] of Object.entries(res.graphs)) {
        if (res.partial.includes(path) && ctx.graphs.has(path)) continue; // keep the L1 graph for files L2 did not finish
        ctx.l1Graphs.set(path, ctx.graphs.get(path));
        ctx.graphs.set(path, g);
      }
      for (const u of res.unresolved) a.unresolved.push({ file: u.file, line: u.line, kind: 'import', detail: u.detail });
      if (res.partial.length) a.notices.push(`L2 hit its time budget: ${res.partial.length} TypeScript/JavaScript file(s) have exact imports but heuristic call edges.`);
    },
  };
}

export const l1Stage: Stage = {
  name: 'Resolving imports and calls (L1)',
  phase: 'graph',
  run(ctx) {
    buildL1Graphs(ctx);
  },
};

/** Measures L1 (heuristic) edges against L2 (exact) on the files where both ran. */
export const accuracyStage: Stage = {
  name: 'Measuring L1 accuracy',
  phase: 'graph',
  run(ctx) {
    const acc = measureL1(ctx);
    if (acc) ctx.a.l1Accuracy = acc;
  },
};

function pr(l1: Set<string>, l2: Set<string>): PR {
  let tp = 0;
  for (const k of l1) if (l2.has(k)) tp++;
  const fp = l1.size - tp;
  const fn = l2.size - tp;
  return { tp, fp, fn, precision: l1.size ? tp / l1.size : 1, recall: l2.size ? tp / l2.size : 1 };
}

export function measureL1(ctx: StageContext): { imports: PR; calls: PR } | null {
  const i1 = new Set<string>();
  const i2 = new Set<string>();
  const c1 = new Set<string>();
  const c2 = new Set<string>();
  let files = 0;
  for (const [path, l1] of ctx.l1Graphs) {
    const l2 = ctx.graphs.get(path);
    if (!l1 || !l2 || l2.level !== 2) continue;
    files++;
    for (const e of l1.imports) if (e.to && e.to !== path) i1.add(`${path}>${e.to}`);
    for (const e of l2.imports) if (e.to && e.to !== path) i2.add(`${path}>${e.to}`);
    for (const r of l1.refs) if (r.kind === 'call' || r.kind === 'new') c1.add(`${path}:${r.line}>${r.toFile}#${r.toName}`);
    for (const r of l2.refs) if (r.kind === 'call' || r.kind === 'new') c2.add(`${path}:${r.line}>${r.toFile}#${r.toName}`);
  }
  return files ? { imports: pr(i1, i2), calls: pr(c1, c2) } : null;
}

export const assembleStage: Stage = {
  name: 'Building the graph',
  phase: 'graph',
  run(ctx) {
    assemble(ctx);
  },
};

export function assemble(ctx: StageContext): void {
  const { a } = ctx;
  const fileIdx = new Map(a.files.map((f, i) => [f.path, i]));
  const symbols: SymbolDef[] = [];
  const imports: ImportEdge[] = [];
  const refs: RefEdge[] = [];
  const base = new Map<string, number>(); // file -> first symbol index
  const byName = new Map<string, Map<string, number[]>>(); // file -> name -> def indexes

  for (const [path, g] of ctx.graphs) {
    const fi = fileIdx.get(path);
    if (fi === undefined) continue;
    base.set(path, symbols.length);
    const names = new Map<string, number[]>();
    g.defs.forEach((d, i) => {
      symbols.push({ name: d.name, kind: d.kind, file: fi, line: d.line, endLine: d.endLine, parent: d.parent, complexity: d.complexity, nesting: d.nesting, params: d.params, exported: d.exported });
      const arr = names.get(d.name);
      if (arr) arr.push(i);
      else names.set(d.name, [i]);
    });
    byName.set(path, names);
    const f = a.files[fi];
    const fns = g.defs.filter((d) => d.kind === 'function' || d.kind === 'method');
    f.level = g.level;
    f.symbols = g.defs.length;
    f.complexity = fns.reduce((s, d) => s + d.complexity, 0);
    f.maxComplexity = fns.reduce((s, d) => Math.max(s, d.complexity), 0);
    f.maxNesting = g.defs.reduce((s, d) => Math.max(s, d.nesting), 0);
  }

  for (const [path, g] of ctx.graphs) {
    const fi = fileIdx.get(path);
    if (fi === undefined) continue;
    const b = base.get(path)!;
    const seenImp = new Set<string>();
    for (const im of g.imports) {
      const to = im.to !== null ? fileIdx.get(im.to) ?? -1 : -1;
      const key = `${to}|${im.spec}|${im.line}`;
      if (seenImp.has(key)) continue;
      seenImp.add(key);
      imports.push({ from: fi, to, spec: im.spec, pkg: to < 0 ? im.pkg : undefined, line: im.line, conf: im.conf, kind: im.kind, names: im.names?.length ? im.names : undefined, typeOnly: im.typeOnly });
    }
    for (const r of g.refs) {
      const tb = base.get(r.toFile);
      const cands = byName.get(r.toFile)?.get(r.toName);
      if (tb === undefined || !cands?.length) continue;
      const tg = ctx.graphs.get(r.toFile)!;
      const local = cands.find((i) => tg.defs[i].line === r.toLine) ?? cands[0];
      refs.push({ from: r.def >= 0 ? b + r.def : -1, file: fi, line: r.line, to: tb + local, kind: r.kind, conf: r.conf });
    }
  }
  a.symbols = symbols;
  a.imports = imports;
  a.refs = refs;
  // statically-unresolvable constructs found by the line scanner
  const seen = new Set(a.unresolved.map((u) => `${u.file}:${u.line}:${u.kind}`));
  ctx.units.forEach((u, i) => {
    for (const x of ctx.results[i]?.scan.unresolved ?? []) {
      const key = `${u.path}:${x.line}:${x.kind}`;
      if (!seen.has(key)) {
        seen.add(key);
        a.unresolved.push({ file: u.path, line: x.line, kind: x.kind, detail: x.detail });
      }
    }
  });
  a.coverage.l1Files = a.files.filter((f) => f.level === 1).length;
  a.coverage.l2Files = a.files.filter((f) => f.level === 2).length;
}

export type { FileGraph };
