// L1 resolution: turn per-file parse results into heuristic import and call
// edges. Nothing here is certain — every edge is marked "heuristic", and what
// cannot be resolved is recorded as "unresolved" rather than guessed.
import type { FileGraph, GImport, GRef } from '../l2/tsgraph';
import type { StageContext } from '../pipeline';
import { ModuleResolver, packageOf } from '../resolve-js';
import type { FileParse, RawCall, RawDef } from '../types';
import { basename, dirname, extname, joinPath, stripExt } from '../util';

const PY_STDLIB = new Set('abc argparse ast asyncio base64 collections concurrent contextlib copy csv dataclasses datetime decimal enum functools glob hashlib heapq http importlib inspect io itertools json logging math multiprocessing operator os pathlib pickle platform queue random re shutil signal socket sqlite3 string struct subprocess sys tempfile threading time traceback types typing unittest urllib uuid warnings weakref xml zipfile __future__'.split(' '));
const SELF = new Set(['this', 'self', '$this', '@', 'cls', 'super', 'base']);

interface Target {
  file: string;
  def: RawDef;
}

interface Binding {
  file: string;
  /** imported name: '*' = the module itself. */
  name: string;
  /** For Go: the package directory (several files). */
  dir?: string;
}

class Index {
  paths = new Set<string>();
  parse = new Map<string, FileParse>();
  lang = new Map<string, string>();
  /** class-like definitions by name. */
  classes = new Map<string, Target[]>();
  /** free functions by name. */
  functions = new Map<string, Target[]>();
  /** methods by name. */
  methods = new Map<string, Target[]>();
  byDir = new Map<string, string[]>();
  byBase = new Map<string, string[]>();
  /** fully qualified type name (pkg.Class / ns\Class) -> file */
  fqn = new Map<string, string>();
  byPkg = new Map<string, string[]>();
  pyModules = new Map<string, string[]>();
  rubyFiles = new Map<string, string[]>();

  add(path: string, lang: string, p: FileParse) {
    this.paths.add(path);
    this.parse.set(path, p);
    this.lang.set(path, lang);
    push(this.byDir, dirname(path), path);
    push(this.byBase, basename(path), path);
    if (p.pkg) push(this.byPkg, p.pkg, path);
    for (const d of p.defs) {
      const t = { file: path, def: d };
      if (d.kind === 'function') push(this.functions, d.name, t);
      else if (d.kind === 'method') push(this.methods, d.name, t);
      else if (d.kind !== 'variable') {
        push(this.classes, d.name, t);
        if (p.pkg && !d.parent) {
          this.fqn.set(`${p.pkg}.${d.name}`, path);
          this.fqn.set(`${p.pkg}\\${d.name}`, path);
        }
      }
    }
    if (lang === 'python') {
      const parts = stripExt(path).split('/');
      if (parts[parts.length - 1] === '__init__') parts.pop();
      for (let i = 0; i < parts.length; i++) push(this.pyModules, parts.slice(i).join('.'), path);
    }
    if (lang === 'ruby') push(this.rubyFiles, basename(stripExt(path)), path);
  }
}

function push<K, V>(m: Map<K, V[]>, k: K, v: V) {
  const a = m.get(k);
  if (a) a.push(v);
  else m.set(k, [v]);
}

/** Among candidate paths, prefer the one sharing the longest directory prefix with `from`. */
function closest(cands: string[], from: string): string | null {
  if (cands.length === 0) return null;
  if (cands.length === 1) return cands[0];
  const fp = from.split('/');
  let best = cands[0];
  let bestScore = -1;
  for (const c of cands) {
    const cp = c.split('/');
    let s = 0;
    while (s < fp.length && s < cp.length && fp[s] === cp[s]) s++;
    if (s > bestScore || (s === bestScore && c.length < best.length)) {
      best = c;
      bestScore = s;
    }
  }
  return best;
}

function snake(name: string): string {
  return name.replace(/([a-z0-9])([A-Z])/g, '$1_$2').replace(/([A-Z]+)([A-Z][a-z])/g, '$1_$2').toLowerCase();
}

export function buildL1Graphs(ctx: StageContext): void {
  const { a } = ctx;
  const idx = new Index();
  ctx.units.forEach((u, i) => {
    const p = ctx.results[i]?.parse;
    if (p) idx.add(u.path, u.lang, p);
  });
  const allPaths = new Set(ctx.units.map((u) => u.path));
  const jsResolver = new ModuleResolver(
    allPaths,
    ctx.units.filter((u) => /^(tsconfig.*|jsconfig)\.json$/.test(basename(u.path))).map((u) => ({ path: u.path, text: u.text })),
    a.l0.manifests.filter((m) => m.type === 'package.json' && m.name).map((m) => ({ name: m.name!, dir: dirname(m.file) })),
  );
  const goModules = a.l0.manifests.filter((m) => m.type === 'go.mod' && m.name).map((m) => ({ name: m.name!, dir: dirname(m.file) }));

  for (const [path, p] of idx.parse) {
    const lang = idx.lang.get(path)!;
    const dir = dirname(path);
    const imports: GImport[] = [];
    const bindings = new Map<string, Binding>();
    const visible = new Set<string>([path]);
    const addEdge = (to: string | null, spec: string, line: number, kind: GImport['kind'], names?: string[], pkg?: string, unresolved = false) => {
      if (to === path) return;
      imports.push({ spec, line, kind, to, names, pkg: to ? undefined : pkg, conf: to ? 'heuristic' : unresolved ? 'unresolved' : 'heuristic' });
      if (to) visible.add(to);
      if (unresolved) a.unresolved.push({ file: path, line, kind: 'import', detail: `"${spec}" could not be resolved to an analysed file` });
    };
    const bind = (local: string, file: string, name: string) => {
      if (local && local !== '*') bindings.set(local, { file, name });
    };

    for (const im of p.imports) {
      const names = im.names?.map((n) => n[0]);
      switch (lang) {
        case 'typescript':
        case 'javascript': {
          const to = jsResolver.resolve(im.spec, path);
          const rel = im.spec.startsWith('.') || im.spec.startsWith('/');
          const asset = /\.(css|scss|sass|less|svg|png|jpe?g|gif|webp|woff2?|ttf|ico|html|md|txt)(\?.*)?$/.test(im.spec);
          imports.push({ spec: im.spec, line: im.line, kind: im.kind, to, names, typeOnly: im.typeOnly, pkg: !to && !rel ? packageOf(im.spec) : undefined, conf: to ? 'heuristic' : rel && !asset ? 'unresolved' : 'heuristic' });
          if (to) {
            visible.add(to);
            for (const [imported, local] of im.names ?? []) bind(local, to, imported);
          } else if (rel && !asset) a.unresolved.push({ file: path, line: im.line, kind: 'import', detail: `"${im.spec}" could not be resolved to an analysed file` });
          break;
        }
        case 'python': {
          const dots = /^\.+/.exec(im.spec)?.[0].length ?? 0;
          const rest = im.spec.slice(dots);
          const tryModule = (mod: string): string | null => {
            if (dots > 0) {
              let base = dir;
              for (let k = 1; k < dots; k++) base = dirname(base);
              const p0 = joinPath(base, mod.replace(/\./g, '/'));
              return allPaths.has(p0 + '.py') ? p0 + '.py' : allPaths.has(p0 + '/__init__.py') ? p0 + '/__init__.py' : null;
            }
            return closest(idx.pyModules.get(mod) ?? [], path);
          };
          let any = false;
          const fromImport = (im.names?.length ?? 0) > 0 && !(im.names!.length === 1 && im.names![0][0] === '*' && im.kind === 'static' && !im.spec.startsWith('.') && im.names![0][1] === im.spec.split('.')[0]);
          if (fromImport) {
            const modFile = rest ? tryModule(rest) : null;
            for (const [imported, local] of im.names!) {
              const sub = imported === '*' ? null : tryModule(rest ? `${rest}.${imported}` : imported);
              if (sub) {
                addEdge(sub, im.spec, im.line, 'static', [imported]);
                bind(local, sub, '*');
                any = true;
              } else if (modFile) bind(local, modFile, imported);
            }
            if (modFile) {
              // a package __init__ is only an edge when nothing more specific was found
              if (!any || !modFile.endsWith('__init__.py')) addEdge(modFile, im.spec, im.line, 'static', names);
              any = true;
            }
          } else {
            const f = tryModule(im.spec);
            if (f) {
              addEdge(f, im.spec, im.line, 'static', names);
              bind(im.names?.[0]?.[1] === im.spec.split('.')[0] ? im.spec : im.names?.[0]?.[1] ?? im.spec, f, '*');
              any = true;
            }
          }
          if (!any) {
            const top = rest.split('.')[0];
            if (dots > 0) addEdge(null, im.spec, im.line, 'static', names, undefined, true);
            else addEdge(null, im.spec, im.line, 'static', names, PY_STDLIB.has(top) ? `python:${top}` : top);
          }
          break;
        }
        case 'java':
        case 'kotlin': {
          if (im.spec.endsWith('.*')) {
            const pkg = im.spec.slice(0, -2);
            const files = idx.byPkg.get(pkg) ?? [];
            const refs = new Set(p.typeRefs ?? []);
            let hit = false;
            for (const f of files) {
              if (idx.parse.get(f)!.defs.some((d) => !d.parent && refs.has(d.name))) {
                addEdge(f, im.spec, im.line, 'static');
                hit = true;
              }
            }
            if (!hit && files.length === 0) addEdge(null, im.spec, im.line, 'static', undefined, javaPkg(pkg));
          } else {
            const suffix = '/' + im.spec.replace(/\./g, '/');
            const to = idx.fqn.get(im.spec) ?? [...allPaths].find((f) => stripExt(f).endsWith(suffix) || ('/' + stripExt(f)).endsWith(suffix)) ?? idx.fqn.get(im.spec.split('.').slice(0, -1).join('.')) ?? null;
            if (to) {
              addEdge(to, im.spec, im.line, 'static', names);
              bind(im.spec.split('.').pop()!, to, im.spec.split('.').pop()!);
            } else addEdge(null, im.spec, im.line, 'static', names, javaPkg(im.spec));
          }
          break;
        }
        case 'go': {
          const mod = goModules.find((m) => im.spec === m.name || im.spec.startsWith(m.name + '/'));
          const alias = im.names?.[0]?.[1] ?? im.spec.split('/').pop()!;
          if (mod) {
            const pkgDir = joinPath(mod.dir, im.spec.slice(mod.name.length));
            const files = (idx.byDir.get(pkgDir) ?? []).filter((f) => f.endsWith('.go') && !f.endsWith('_test.go'));
            if (files.length) {
              const used = new Set(p.calls.filter((c) => c.recv === alias).map((c) => c.name));
              const targets = files.filter((f) => idx.parse.get(f)!.defs.some((d) => used.has(d.name)));
              for (const t of targets.length ? targets : [files.sort()[0]]) addEdge(t, im.spec, im.line, 'static');
              bindings.set(alias, { file: files[0], name: '*', dir: pkgDir });
            } else addEdge(null, im.spec, im.line, 'static', undefined, undefined, true);
          } else addEdge(null, im.spec, im.line, 'static', undefined, im.spec.includes('.') ? im.spec.split('/').slice(0, 3).join('/') : `go:${im.spec}`);
          break;
        }
        case 'c':
        case 'cpp': {
          if (im.spec.startsWith('<')) {
            const inner = im.spec.slice(1, -1);
            const local = closest([...(idx.byBase.get(basename(inner)) ?? [])].filter((f) => f.endsWith('/' + inner) || f === inner), path);
            if (local) addEdge(local, im.spec, im.line, 'include');
            else addEdge(null, im.spec, im.line, 'include', undefined, `c:${inner}`);
          } else {
            const rel = joinPath(dir, im.spec);
            const to = allPaths.has(rel) ? rel : closest((idx.byBase.get(basename(im.spec)) ?? []).filter((f) => f.endsWith('/' + im.spec.replace(/^(\.\.?\/)+/, '')) || f === im.spec), path);
            addEdge(to, im.spec, im.line, 'include', undefined, undefined, !to);
          }
          break;
        }
        case 'csharp': {
          const files = idx.byPkg.get(im.spec);
          if (!files) addEdge(null, im.spec, im.line, 'static', undefined, /^(System|Microsoft)(\.|$)/.test(im.spec) ? `dotnet:${im.spec.split('.').slice(0, 2).join('.')}` : im.spec.split('.').slice(0, 2).join('.'));
          break; // internal namespaces become edges through type references below
        }
        case 'php': {
          if (im.kind === 'include') {
            const cands = [joinPath(dir, im.spec), joinPath(im.spec)];
            let to = cands.find((c) => allPaths.has(c)) ?? null;
            if (!to) to = closest([...allPaths].filter((f) => f.endsWith('/' + im.spec.replace(/^(\.\.?\/)+/, ''))), path);
            addEdge(to, im.spec, im.line, 'include', undefined, undefined, !to);
          } else {
            const last = im.spec.split('\\').pop()!;
            const to = idx.fqn.get(im.spec) ?? closest([...allPaths].filter((f) => f.endsWith('/' + im.spec.split('\\').slice(1).join('/') + '.php')), path) ?? closest((idx.classes.get(last) ?? []).map((t) => t.file), path);
            if (to) {
              addEdge(to, im.spec, im.line, 'static', names);
              bind(im.names?.[0]?.[1] ?? last, to, last);
            } else addEdge(null, im.spec, im.line, 'static', names, im.spec.split('\\').slice(0, 2).join('\\'));
          }
          break;
        }
        case 'ruby': {
          let to: string | null = null;
          if (im.kind === 'include') {
            const rel = joinPath(dir, im.spec);
            to = allPaths.has(rel + '.rb') ? rel + '.rb' : allPaths.has(rel) ? rel : null;
            addEdge(to, im.spec, im.line, 'include', undefined, undefined, !to);
          } else {
            to = closest([...allPaths].filter((f) => f === `lib/${im.spec}.rb` || f.endsWith(`/lib/${im.spec}.rb`) || f === `${im.spec}.rb`), path);
            addEdge(to, im.spec, im.line, 'require', undefined, im.spec.split('/')[0]);
          }
          break;
        }
        case 'rust': {
          if (im.spec.startsWith('mod ')) {
            const name = im.spec.slice(4);
            const b = basename(path);
            const base = b === 'mod.rs' || b === 'lib.rs' || b === 'main.rs' ? dir : joinPath(dir, stripExt(b));
            const to = [joinPath(base, name + '.rs'), joinPath(base, name, 'mod.rs')].find((c) => allPaths.has(c)) ?? null;
            addEdge(to, im.spec, im.line, 'include', undefined, undefined, !to);
            if (to) bindings.set(name, { file: to, name: '*' });
            break;
          }
          const segs = im.spec.split('::');
          let base: string | null = null;
          let rest = segs;
          if (segs[0] === 'crate') {
            const i = path.lastIndexOf('src/');
            base = i >= 0 ? path.slice(0, i + 3) : dir;
            rest = segs.slice(1);
          } else if (segs[0] === 'self') {
            base = basename(path) === 'mod.rs' || basename(path) === 'lib.rs' || basename(path) === 'main.rs' ? dir : joinPath(dir, stripExt(basename(path)));
            rest = segs.slice(1);
          } else if (segs[0] === 'super') {
            base = basename(path) === 'mod.rs' ? dirname(dir) : dir;
            rest = segs.slice(1);
            while (rest[0] === 'super') {
              base = dirname(base);
              rest = rest.slice(1);
            }
          }
          if (base === null) {
            addEdge(null, im.spec, im.line, 'static', names, ['std', 'core', 'alloc'].includes(segs[0]) ? `rust:${segs[0]}` : segs[0]);
            break;
          }
          let to: string | null = null;
          for (let n = rest.length; n > 0 && !to; n--) {
            const p0 = joinPath(base, rest.slice(0, n).join('/'));
            to = allPaths.has(p0 + '.rs') ? p0 + '.rs' : allPaths.has(p0 + '/mod.rs') ? p0 + '/mod.rs' : null;
          }
          addEdge(to, im.spec, im.line, 'static', names, undefined, !to);
          if (to) bind(rest[rest.length - 1], to, rest[rest.length - 1]);
          break;
        }
        default:
          break;
      }
    }

    // ---- type-reference edges (same package / namespace / autoload conventions) ----
    if (p.typeRefs?.length) {
      const own = new Set(p.defs.map((d) => d.name));
      const usable = new Set<string>();
      if (lang === 'csharp') {
        if (p.pkg) {
          const parts = p.pkg.split('.');
          for (let i = parts.length; i > 0; i--) usable.add(parts.slice(0, i).join('.'));
        }
        for (const im of p.imports) usable.add(im.spec);
      }
      for (const name of p.typeRefs) {
        if (own.has(name)) continue;
        const cands = (idx.classes.get(name) ?? []).filter((t) => t.file !== path && !t.def.parent);
        if (cands.length === 0) {
          if (lang === 'ruby') {
            const f = closest(idx.rubyFiles.get(snake(name)) ?? [], path);
            if (f && f !== path && !visible.has(f)) addEdge(f, name, 1, 'typeref', [name]);
          }
          continue;
        }
        let target: Target | undefined;
        if (lang === 'java' || lang === 'kotlin') target = cands.find((t) => idx.parse.get(t.file)!.pkg === p.pkg && idx.lang.get(t.file) === lang);
        else if (lang === 'csharp') target = cands.find((t) => usable.has(idx.parse.get(t.file)!.pkg ?? '')) ?? (cands.length === 1 ? cands[0] : undefined);
        else if (lang === 'php') target = cands.find((t) => idx.parse.get(t.file)!.pkg === p.pkg && !!p.pkg) ?? (cands.filter((t) => idx.lang.get(t.file) === 'php').length === 1 && !bindings.has(name) ? cands.find((t) => idx.lang.get(t.file) === 'php') : undefined);
        else if (lang === 'ruby') target = cands.filter((t) => idx.lang.get(t.file) === 'ruby').length >= 1 ? cands.find((t) => t.file === closest(cands.filter((c) => idx.lang.get(c.file) === 'ruby').map((c) => c.file), path)) : undefined;
        if (target && !visible.has(target.file)) {
          const line = firstLineOf(ctx.unitByPath.get(path)?.text ?? '', name);
          addEdge(target.file, name, line, 'typeref', [name]);
        }
        if (target) bindings.set(name, { file: target.file, name });
      }
    }

    // ---- calls ----
    const refs: GRef[] = [];
    const seen = new Set<string>();
    const emit = (c: RawCall, t: Target, kind: GRef['kind']) => {
      const key = `${c.def}|${c.line}|${t.file}|${t.def.name}|${t.def.line}`;
      if (seen.has(key)) return;
      seen.add(key);
      refs.push({ line: c.line, def: c.def, toFile: t.file, toName: t.def.name, toLine: t.def.line, kind, conf: 'heuristic' });
      // a call into another file that is not imported (PHP/C globals, Go same package) still creates a dependency
      if (t.file !== path && !visible.has(t.file)) {
        addEdge(t.file, t.def.name, c.line, 'typeref', [t.def.name]);
      }
    };
    const inFile = (file: string, name: string, pred: (d: RawDef) => boolean = () => true): Target | null => {
      const d = idx.parse.get(file)?.defs.find((x) => x.name === name && pred(x));
      return d ? { file, def: d } : null;
    };
    const isFn = (d: RawDef) => d.kind === 'function' || d.kind === 'method';
    const isClass = (d: RawDef) => d.kind !== 'function' && d.kind !== 'method' && d.kind !== 'variable';
    const globalFns = lang === 'php' || lang === 'c' || lang === 'cpp';

    for (const c of p.calls) {
      const encl = c.def >= 0 ? p.defs[c.def] : undefined;
      const kind: GRef['kind'] = c.isNew ? 'new' : 'call';
      let t: Target | null = null;
      if (!c.recv) {
        const b = bindings.get(c.name);
        if (b) t = inFile(b.file, b.name === '*' || b.name === 'default' ? c.name : b.name) ?? (b.name === 'default' ? defaultExport(idx, b.file) : null);
        if (!t && encl?.parent) t = inFile(path, c.name, (d) => d.kind === 'method' && d.parent === encl.parent);
        if (!t) t = inFile(path, c.name, (d) => (c.isNew ? isClass(d) : d.kind === 'function' || (isClass(d) && (lang === 'python' || lang === 'kotlin'))));
        if (!t && !c.isNew && lang === 'go') {
          for (const f of idx.byDir.get(dir) ?? []) if (f !== path && (t = inFile(f, c.name, (d) => d.kind === 'function'))) break;
        }
        if (!t && c.isNew) {
          const cands = (idx.classes.get(c.name) ?? []).filter((x) => visible.has(x.file));
          t = cands[0] ?? uniqueOf(idx.classes.get(c.name), lang, idx);
        }
        if (!t && !c.isNew && globalFns) {
          const cands = (idx.functions.get(c.name) ?? []).filter((x) => idx.lang.get(x.file) === lang || (lang !== 'php' && idx.lang.get(x.file) !== 'php'));
          t = cands.find((x) => visible.has(x.file)) ?? (cands.length === 1 ? cands[0] : null);
        }
      } else if (SELF.has(c.recv)) {
        if (encl?.parent) t = inFile(path, c.name, (d) => d.parent === encl.parent && isFn(d));
        if (!t) t = inFile(path, c.name, isFn);
      } else {
        const head = c.recv.split(/[.:>\-(\[]/)[0];
        const b = bindings.get(c.recv) ?? (c.recv.includes('.') || c.recv.includes('::') ? undefined : bindings.get(head));
        if (b) {
          if (b.dir) {
            for (const f of idx.byDir.get(b.dir) ?? []) if ((t = inFile(f, c.name, (d) => !d.parent || isClass(d)))) break;
          } else {
            t = b.name === '*' || b.name === 'default'
              ? inFile(b.file, c.name)
              : inFile(b.file, c.name, (d) => d.parent === b.name) ?? inFile(b.file, c.name, isFn);
          }
        }
        if (!t) {
          // guess the receiver's class from its name: orderService / $this->repo / self.order_repo
          const seg = c.recv.split(/\.|->|::/).pop()!.replace(/^[$@_]+|^m_/, '').replace(/\(.*$/, '').replace(/_/g, '').toLowerCase();
          if (seg.length > 2) {
            outer: for (const f of visible) {
              for (const d of idx.parse.get(f)?.defs ?? []) {
                if (!isClass(d)) continue;
                const cn = d.name.toLowerCase();
                if (cn === seg || (cn.length > 3 && seg.endsWith(cn)) || (seg.length > 3 && cn.endsWith(seg) && cn.length - seg.length <= 4)) {
                  t = inFile(f, c.name, (m) => m.parent === d.name);
                  if (t) break outer;
                }
              }
            }
          }
        }
        if (!t) {
          // last resort: exactly one definition with this name among the files this file can see
          const cands: Target[] = [];
          for (const f of visible) {
            if (f === path) continue;
            for (const d of idx.parse.get(f)?.defs ?? []) if (d.name === c.name && isFn(d)) cands.push({ file: f, def: d });
          }
          if (cands.length === 1) t = cands[0];
        }
      }
      if (t && !(t.file === path && c.def >= 0 && p.defs[c.def] === t.def && !isFn(t.def))) emit(c, t, kind);
    }

    ctx.graphs.set(path, { level: 1, defs: p.defs, imports, refs });
  }
}

function defaultExport(idx: Index, file: string): Target | null {
  const defs = idx.parse.get(file)?.defs ?? [];
  const d = defs.find((x) => x.exported && (x.kind === 'function' || x.kind === 'class')) ?? null;
  return d ? { file, def: d } : null;
}

function uniqueOf(cands: Target[] | undefined, lang: string, idx: Index): Target | null {
  const same = (cands ?? []).filter((t) => idx.lang.get(t.file) === lang);
  return same.length === 1 ? same[0] : null;
}

function javaPkg(spec: string): string {
  const parts = spec.split('.');
  if (parts[0] === 'java' || parts[0] === 'javax' || parts[0] === 'kotlin' || parts[0] === 'kotlinx') return `${parts[0] === 'kotlin' || parts[0] === 'kotlinx' ? 'kotlin' : 'java'}:${parts.slice(0, 2).join('.')}`;
  return parts.slice(0, Math.min(3, Math.max(2, parts.length - 1))).join('.');
}

function firstLineOf(text: string, word: string): number {
  const re = new RegExp(`\\b${word}\\b`);
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (re.test(lines[i]) && !/^\s*(import|package|using|use|namespace)\b/.test(lines[i])) return i + 1;
  }
  return 1;
}

export { extname };
