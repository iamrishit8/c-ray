// Dependency intelligence: cycles, coupling metrics, god modules, layering
// violations and external package usage.
import { CODE_LANGS } from './l0/languages';
import { modelOf } from './model';
import type { Stage, StageContext } from './pipeline';
import type { Analysis, Cycle, DepsResult, ExternalPkg, LayerViolation, Role } from './types';
import { dirname } from './util';

const MAX_CYCLES = 300;

/** Strongly connected components (iterative Tarjan) over runtime import edges. */
function sccs(n: number, adj: number[][]): number[][] {
  const index = new Int32Array(n).fill(-1);
  const low = new Int32Array(n);
  const onStack = new Uint8Array(n);
  const stack: number[] = [];
  const out: number[][] = [];
  let counter = 0;
  for (let root = 0; root < n; root++) {
    if (index[root] !== -1) continue;
    const work: [number, number][] = [[root, 0]];
    while (work.length) {
      const top = work[work.length - 1];
      const v = top[0];
      if (top[1] === 0) {
        index[v] = low[v] = counter++;
        stack.push(v);
        onStack[v] = 1;
      }
      if (top[1] < adj[v].length) {
        const w = adj[v][top[1]++];
        if (index[w] === -1) work.push([w, 0]);
        else if (onStack[w]) low[v] = Math.min(low[v], index[w]);
      } else {
        if (low[v] === index[v]) {
          const comp: number[] = [];
          let w: number;
          do {
            w = stack.pop()!;
            onStack[w] = 0;
            comp.push(w);
          } while (w !== v);
          if (comp.length > 1) out.push(comp);
        }
        work.pop();
        if (work.length) {
          const p = work[work.length - 1][0];
          low[p] = Math.min(low[p], low[v]);
        }
      }
    }
  }
  return out;
}

function findCycles(a: Analysis): { cycles: Cycle[]; capped: boolean } {
  const n = a.files.length;
  const adjSet: Set<number>[] = Array.from({ length: n }, () => new Set());
  const edgeInfo = new Map<string, { line: number; conf: Cycle['edges'][number]['conf'] }>();
  for (const e of a.imports) {
    if (e.to < 0 || e.to === e.from || e.typeOnly) continue;
    adjSet[e.from].add(e.to);
    const k = `${e.from}>${e.to}`;
    if (!edgeInfo.has(k)) edgeInfo.set(k, { line: e.line, conf: e.conf });
  }
  const adj = adjSet.map((s) => [...s]);
  const cycles: Cycle[] = [];
  let capped = false;
  const mk = (path: number[]): Cycle => ({
    files: path.map((i) => a.files[i].path),
    edges: path.map((from, k) => {
      const to = path[(k + 1) % path.length];
      const info = edgeInfo.get(`${from}>${to}`)!;
      return { from: a.files[from].path, to: a.files[to].path, line: info.line, conf: info.conf };
    }),
  });
  for (const comp of sccs(n, adj)) {
    const inComp = new Set(comp);
    comp.sort((x, y) => x - y);
    // elementary cycles, each reported once (rooted at its smallest node), shortest first
    const found: number[][] = [];
    const limit = Math.min(60, MAX_CYCLES - cycles.length);
    for (const start of comp) {
      if (found.length >= limit) break;
      const path: number[] = [start];
      const onPath = new Set([start]);
      let steps = 0;
      const dfs = (v: number) => {
        if (found.length >= limit || steps++ > 20_000 || path.length > 12) return;
        for (const w of adj[v]) {
          if (!inComp.has(w) || w < start) continue;
          if (w === start) found.push([...path]);
          else if (!onPath.has(w)) {
            onPath.add(w);
            path.push(w);
            dfs(w);
            path.pop();
            onPath.delete(w);
          }
          if (found.length >= limit) return;
        }
      };
      dfs(start);
    }
    if (found.length >= limit) capped = true;
    if (found.length === 0) found.push(comp); // very large component: report it as one group
    found.sort((x, y) => x.length - y.length);
    for (const f of found) {
      if (f.every((from, k) => edgeInfo.has(`${from}>${f[(k + 1) % f.length]}`))) cycles.push(mk(f));
      else cycles.push({ files: f.map((i) => a.files[i].path), edges: [] });
    }
    if (cycles.length >= MAX_CYCLES) {
      capped = true;
      break;
    }
  }
  return { cycles, capped };
}

const UPPER: Role[] = ['controller', 'route', 'view', 'page', 'component'];
const VIEWS: Role[] = ['view', 'page', 'component'];

function findViolations(a: Analysis): LayerViolation[] {
  const m = modelOf(a);
  const out: LayerViolation[] = [];
  const hasLayer = a.files.some((f) => !f.test && (f.role === 'service' || f.role === 'repository'));
  const seen = new Set<string>();
  const add = (v: LayerViolation) => {
    const k = `${v.file}:${v.line}:${v.rule}`;
    if (!seen.has(k)) {
      seen.add(k);
      out.push(v);
    }
  };
  // R1: presentation / HTTP layer touching the database directly
  for (const f of a.facts) {
    if (f.kind !== 'db') continue;
    const file = m.file(f.file);
    if (!file || file.test) continue;
    if (VIEWS.includes(file.role)) {
      add({ file: f.file, line: f.line, fromRole: file.role, toRole: 'db', target: f.target, rule: 'view-db', conf: 'heuristic', detail: `A ${file.role} accesses the database directly (${f.detail}). Views normally receive data rather than query it.` });
    } else if ((file.role === 'controller' || file.role === 'route') && hasLayer) {
      add({ file: f.file, line: f.line, fromRole: file.role, toRole: 'db', target: f.target, rule: 'controller-db', conf: 'heuristic', detail: `A ${file.role} accesses the database directly (${f.detail}) although the project has a service/repository layer.` });
    }
  }
  // R2-R4: import direction between layers
  for (const e of a.imports) {
    if (e.to < 0 || e.typeOnly) continue;
    const from = a.files[e.from];
    const to = a.files[e.to];
    if (from.test || to.test) continue;
    if (UPPER.includes(from.role) && to.role === 'repository' && a.files.some((x) => x.role === 'service')) {
      add({ file: from.path, line: e.line, fromRole: from.role, toRole: 'repository', target: to.path, rule: 'skip-service', conf: 'heuristic', detail: `A ${from.role} imports a repository (${to.path}) directly, bypassing the service layer.` });
    }
    if ((to.role === 'controller' || to.role === 'route') && ['service', 'repository', 'model', 'util'].includes(from.role)) {
      add({ file: from.path, line: e.line, fromRole: from.role, toRole: to.role, target: to.path, rule: 'upward-dependency', conf: 'heuristic', detail: `A ${from.role} depends on the ${to.role} layer (${to.path}); lower layers normally do not know about the HTTP layer.` });
    }
    if (from.role === 'model' && (to.role === 'service' || to.role === 'repository')) {
      add({ file: from.path, line: e.line, fromRole: 'model', toRole: to.role, target: to.path, rule: 'upward-dependency', conf: 'heuristic', detail: `A model depends on a ${to.role} (${to.path}).` });
    }
  }
  return out.sort((x, y) => (x.file < y.file ? -1 : x.file > y.file ? 1 : x.line - y.line));
}

const PY_ALIASES: Record<string, string> = { rest_framework: 'djangorestframework', yaml: 'pyyaml', cv2: 'opencv-python', PIL: 'pillow', sklearn: 'scikit-learn', bs4: 'beautifulsoup4', dateutil: 'python-dateutil', dotenv: 'python-dotenv', jwt: 'pyjwt', psycopg2: 'psycopg2-binary', MySQLdb: 'mysqlclient', jose: 'python-jose', magic: 'python-magic', attr: 'attrs', google: 'google-api-python-client' };
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

function findPackages(a: Analysis): ExternalPkg[] {
  const byName = new Map<string, ExternalPkg>();
  const jsDeclared = new Map<string, { version?: string; manifest: string; dir: string }[]>();
  const otherDeclared: { name: string; n: string; version?: string; manifest: string }[] = [];
  for (const m of a.l0.manifests) {
    for (const d of m.deps) {
      if (m.type === 'package.json') {
        const arr = jsDeclared.get(d.name) ?? [];
        arr.push({ version: d.version, manifest: m.file, dir: dirname(m.file) });
        jsDeclared.set(d.name, arr);
      } else otherDeclared.push({ name: d.name, n: norm(d.name), version: d.version, manifest: m.file });
    }
  }
  const workspace = new Set(a.l0.manifests.filter((m) => m.type === 'package.json' && m.name).map((m) => m.name!));
  const used = new Set<string>();
  for (const e of a.imports) {
    if (e.to >= 0 || !e.pkg) continue;
    const file = a.files[e.from];
    let p = byName.get(e.pkg);
    if (!p) {
      p = { name: e.pkg, declared: false, uses: [] };
      const builtin = /^[a-z]+:/.test(e.pkg);
      if (builtin) p.declared = true;
      else if (file.lang === 'javascript' || file.lang === 'typescript') {
        const decl = jsDeclared.get(e.pkg) ?? (e.pkg.startsWith('@types/') ? undefined : jsDeclared.get('@types/' + e.pkg));
        if (decl) {
          const best = decl.filter((d) => d.dir === '' || file.path.startsWith(d.dir + '/')).sort((x, y) => y.dir.length - x.dir.length)[0] ?? decl[0];
          p.declared = true;
          p.version = best.version;
          p.manifest = best.manifest;
        } else if (workspace.has(e.pkg)) p.declared = true;
      } else {
        const want = norm(PY_ALIASES[e.pkg] ?? e.pkg);
        const last = norm(e.pkg.split(/[./\\:]/).filter(Boolean).pop() ?? e.pkg);
        const hit = otherDeclared.find((d) => d.n === want) ?? otherDeclared.find((d) => d.n.length > 2 && (want.includes(d.n) || d.n.includes(want) || d.n.includes(last)));
        if (hit) {
          p.declared = true;
          p.version = hit.version;
          p.manifest = hit.manifest;
          used.add(hit.name);
        }
      }
      byName.set(e.pkg, p);
    }
    used.add(e.pkg);
    if (p.uses.length < 500) p.uses.push({ file: file.path, line: e.line });
  }
  // declared but never imported (reliable for package.json only)
  for (const [name, decls] of jsDeclared) {
    if (byName.has(name) || name.startsWith('@types/')) continue;
    byName.set(name, { name, declared: true, version: decls[0].version, manifest: decls[0].manifest, uses: [] });
  }
  return [...byName.values()].sort((x, y) => y.uses.length - x.uses.length || (x.name < y.name ? -1 : 1));
}

export function analyzeDeps(a: Analysis): { deps: DepsResult; notices: string[] } {
  const m = modelOf(a);
  const notices: string[] = [];
  const { cycles, capped } = findCycles(a);
  if (capped) notices.push(`More than ${MAX_CYCLES} circular dependency paths exist; only the shortest are listed.`);
  const metrics = a.files.map((f, i) => {
    const fanIn = m.dependents(i).length;
    const fanOut = m.deps(i).length;
    return { file: f.path, fanIn, fanOut, instability: fanIn + fanOut === 0 ? 0 : Math.round((fanOut / (fanIn + fanOut)) * 100) / 100 };
  }).filter((x, i) => CODE_LANGS.has(a.files[i].lang));
  const byFile = new Map(metrics.map((x) => [x.file, x]));
  const godModules: DepsResult['godModules'] = [];
  for (const f of a.files) {
    const mt = byFile.get(f.path);
    if (!mt || f.test) continue;
    const reasons: string[] = [];
    if (f.loc > 1000) reasons.push(`${f.loc} lines`);
    if (f.symbols > 50) reasons.push(`${f.symbols} definitions`);
    if (mt.fanOut > 20) reasons.push(`imports ${mt.fanOut} files`);
    if (mt.fanIn > 30) reasons.push(`imported by ${mt.fanIn} files`);
    if (f.complexity > 250) reasons.push(`total complexity ${f.complexity}`);
    if (reasons.length >= 2) godModules.push({ file: f.path, reasons, fanIn: mt.fanIn, fanOut: mt.fanOut, loc: f.loc, symbols: f.symbols });
  }
  godModules.sort((x, y) => y.reasons.length - x.reasons.length || y.loc - x.loc);
  return { deps: { cycles, metrics, godModules, violations: findViolations(a), packages: findPackages(a) }, notices };
}

export const depsStage: Stage = {
  name: 'Analysing dependencies',
  phase: 'deep',
  run(ctx: StageContext) {
    const { deps, notices } = analyzeDeps(ctx.a);
    ctx.a.deps = deps;
    ctx.a.notices.push(...notices);
  },
};
