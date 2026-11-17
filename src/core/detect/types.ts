// Detector plugin interface. A detector recognises one framework (or one
// cross-cutting concern) and reports routes, roles and facts with locations.
// To add one: implement Detector and append it to DETECTORS in ./index.ts.
import { modelOf, type Model } from '../model';
import type { Analysis, Confidence, DetectedFramework, EntryPoint, Evidence, Fact, FileUnit, Role, Route, Unresolved } from '../types';
import { dirname, LineIndex } from '../util';

export interface RoleHint {
  file: string;
  role: Role;
  conf: Confidence;
}

export interface DetectorResult {
  routes?: Route[];
  facts?: Fact[];
  entries?: EntryPoint[];
  roles?: RoleHint[];
  unresolved?: Unresolved[];
}

export interface Detector {
  id: string;
  name: string;
  /** Returns evidence when the framework is present, otherwise null/empty. */
  detect(ctx: DetectContext): Evidence[] | null;
  analyze(ctx: DetectContext): DetectorResult;
}

export interface Match {
  file: string;
  line: number;
  index: number;
  m: RegExpExecArray;
}

export interface ResolvedName {
  sym: number;
  file: string;
  line: number;
  endLine: number;
  conf: Confidence;
}

const lineIdxCache = new WeakMap<FileUnit, LineIndex>();

export class DetectContext {
  readonly m: Model;
  readonly byLang = new Map<string, FileUnit[]>();
  private tech: Set<string>;
  private fileSet: Map<string, FileUnit>;
  /** refs indexed by file -> line -> ref targets */
  private refsAt = new Map<number, Map<number, number[]>>();

  constructor(readonly a: Analysis, readonly units: FileUnit[]) {
    this.m = modelOf(a);
    this.tech = new Set(a.l0.tech.map((t) => t.id));
    this.fileSet = new Map(units.map((u) => [u.path, u]));
    for (const u of units) {
      const arr = this.byLang.get(u.lang);
      if (arr) arr.push(u);
      else this.byLang.set(u.lang, [u]);
    }
    for (const r of a.refs) {
      let byLine = this.refsAt.get(r.file);
      if (!byLine) this.refsAt.set(r.file, (byLine = new Map()));
      const arr = byLine.get(r.line);
      if (arr) arr.push(r.to);
      else byLine.set(r.line, [r.to]);
    }
  }

  hasTech(...ids: string[]): boolean {
    return ids.some((id) => this.tech.has(id));
  }

  techEvidence(...ids: string[]): Evidence[] {
    return this.a.l0.tech.filter((t) => ids.includes(t.id)).flatMap((t) => t.evidence.slice(0, 2));
  }

  files(...langs: string[]): FileUnit[] {
    return langs.flatMap((l) => this.byLang.get(l) ?? []);
  }

  unit(path: string): FileUnit | undefined {
    return this.fileSet.get(path);
  }

  lineAt(u: FileUnit, index: number): number {
    let li = lineIdxCache.get(u);
    if (!li) lineIdxCache.set(u, (li = new LineIndex(u.text)));
    return li.lineAt(index);
  }

  /** All matches of a global regex in one file. */
  grep(u: FileUnit, re: RegExp): Match[] {
    const out: Match[] = [];
    const g = new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g');
    let m: RegExpExecArray | null;
    while ((m = g.exec(u.text))) {
      out.push({ file: u.path, line: this.lineAt(u, m.index), index: m.index, m });
      if (m[0].length === 0) g.lastIndex++;
    }
    return out;
  }

  /** First evidence of a pattern across files of the given languages. */
  firstEvidence(langs: string[], re: RegExp, note: string, max = 3): Evidence[] {
    const out: Evidence[] = [];
    for (const u of this.files(...langs)) {
      const m = re.exec(u.text);
      if (m) {
        out.push({ file: u.path, line: this.lineAt(u, m.index), kind: 'code', note });
        if (out.length >= max) break;
      }
    }
    return out;
  }

  symInfo(sym: number, conf: Confidence): ResolvedName {
    const s = this.a.symbols[sym];
    return { sym, file: this.m.path(s.file), line: s.line, endLine: s.endLine, conf };
  }

  /**
   * Resolve an expression like `handler`, `ctrl.list` or `pkg.Func` used at file:line to a definition.
   * Exact when L2 recorded a reference on that line; otherwise by name through the file's imports.
   */
  resolve(file: string, line: number, expr: string, endLine = line): ResolvedName | null {
    const parts = expr.replace(/\(.*$/, '').replace(/^\$this->|^this\.|^self\./, '').split(/\.|::|->/).map((p) => p.trim()).filter(Boolean);
    const name = parts[parts.length - 1];
    if (!name || !/^[A-Za-z_$][\w$]*$/.test(name)) return null;
    const fi = this.m.fileIdx.get(file);
    if (fi === undefined) return null;
    const exact = this.a.files[fi].level === 2;
    const byLine = this.refsAt.get(fi);
    if (byLine) {
      for (let l = line; l <= endLine; l++) {
        for (const to of byLine.get(l) ?? []) if (this.a.symbols[to].name === name) return this.symInfo(to, exact ? 'resolved' : 'heuristic');
      }
    }
    const owner = parts.length > 1 ? parts[parts.length - 2] : undefined;
    // same file
    for (const si of this.m.symsByFile[fi]) {
      const s = this.a.symbols[si];
      if (s.name === name && (!owner || s.parent === owner || parts.length === 1)) return this.symInfo(si, 'heuristic');
    }
    if (parts.length === 1) for (const si of this.m.symsByFile[fi]) if (this.a.symbols[si].name === name) return this.symInfo(si, 'heuristic');
    // imported files: prefer the one whose path mentions the qualifier
    const cands: number[] = [];
    for (const dep of this.m.deps(fi)) {
      for (const si of this.m.symsByFile[dep]) {
        const s = this.a.symbols[si];
        if (s.name === name && (s.kind === 'function' || s.kind === 'method' || s.kind === 'class')) cands.push(si);
      }
    }
    if (cands.length === 0) {
      // not imported (e.g. Go: same package, PHP: global function): same directory first, then project-unique
      const all: number[] = [];
      this.a.symbols.forEach((sy, i) => {
        if (sy.name === name && (sy.kind === 'function' || sy.kind === 'method') && this.a.files[sy.file].lang === this.a.files[fi].lang) all.push(i);
      });
      const sameDir = all.filter((i) => dirname(this.m.path(this.a.symbols[i].file)) === dirname(file));
      const pick = sameDir.length >= 1 ? sameDir[0] : all.length === 1 ? all[0] : undefined;
      return pick === undefined ? null : this.symInfo(pick, 'heuristic');
    }
    if (owner) {
      const low = owner.toLowerCase().replace(/[_$]/g, '');
      const best = cands.find((si) => this.a.symbols[si].parent?.toLowerCase() === low) ?? cands.find((si) => this.m.path(this.a.symbols[si].file).toLowerCase().replace(/[_\-/.]/g, '').includes(low));
      if (best !== undefined) return this.symInfo(best, 'heuristic');
    }
    return cands.length === 1 || !owner ? this.symInfo(cands[0], 'heuristic') : null;
  }

  /** Resolve a class/type name anywhere in the project (same directory preferred). */
  resolveClass(name: string, from?: string): ResolvedName | null {
    let best = -1;
    let bestScore = -1;
    this.a.symbols.forEach((s, i) => {
      if (s.name !== name || s.kind === 'function' || s.kind === 'method' || s.kind === 'variable') return;
      const p = this.m.path(s.file);
      const score = from ? common(dirname(p), dirname(from)) : 0;
      if (score > bestScore) {
        best = i;
        bestScore = score;
      }
    });
    return best >= 0 ? this.symInfo(best, 'heuristic') : null;
  }

  /** The function/method definition that starts at or just after a line (e.g. below decorators). */
  defAfter(file: string, line: number, within = 12): number {
    const fi = this.m.fileIdx.get(file);
    if (fi === undefined) return -1;
    let best = -1;
    for (const si of this.m.symsByFile[fi]) {
      const s = this.a.symbols[si];
      if ((s.kind === 'function' || s.kind === 'method' || s.kind === 'class') && s.line >= line && s.line <= line + within && (best < 0 || s.line < this.a.symbols[best].line)) best = si;
    }
    return best;
  }

  /** Innermost class-like symbol containing a line. */
  classAt(file: string, line: number): number {
    const fi = this.m.fileIdx.get(file);
    if (fi === undefined) return -1;
    let best = -1;
    for (const si of this.m.symsByFile[fi]) {
      const s = this.a.symbols[si];
      if (s.kind !== 'function' && s.kind !== 'method' && s.kind !== 'variable' && s.line <= line && line <= s.endLine && (best < 0 || s.line > this.a.symbols[best].line)) best = si;
    }
    return best;
  }
}

function common(a: string, b: string): number {
  const x = a.split('/');
  const y = b.split('/');
  let i = 0;
  while (i < x.length && i < y.length && x[i] === y[i]) i++;
  return i;
}

/** Split the arguments of a call whose "(" is at `open`. Returns top-level args and the index of ")". */
export function callArgs(text: string, open: number, maxLen = 6000): { args: { text: string; start: number; end: number }[]; end: number } | null {
  if (text[open] !== '(') return null;
  const args: { text: string; start: number; end: number }[] = [];
  let depth = 0;
  let start = open + 1;
  let quote = '';
  const limit = Math.min(text.length, open + maxLen);
  for (let i = open; i < limit; i++) {
    const c = text[i];
    if (quote) {
      if (c === '\\') i++;
      else if (c === quote) quote = '';
      continue;
    }
    if (c === '"' || c === "'" || c === '`') quote = c;
    else if (c === '/' && text[i + 1] === '/') {
      const nl = text.indexOf('\n', i);
      i = nl < 0 ? limit : nl;
    } else if (c === '(' || c === '[' || c === '{') depth++;
    else if (c === ')' || c === ']' || c === '}') {
      depth--;
      if (depth === 0) {
        if (text.slice(start, i).trim()) args.push({ text: text.slice(start, i).trim(), start, end: i });
        return { args, end: i };
      }
    } else if (c === ',' && depth === 1) {
      args.push({ text: text.slice(start, i).trim(), start, end: i });
      start = i + 1;
    }
  }
  return null;
}

/** The string literal value of an argument, or null when it is not a plain literal. */
export function literal(arg: string | undefined): string | null {
  if (arg === undefined) return null;
  const m = /^[rbfu@]?(["'`])((?:[^\\]|\\.)*?)\1$/s.exec(arg.trim());
  if (!m) return null;
  if (m[1] === '`' && m[2].includes('${')) return null;
  return m[2];
}

export function joinRoute(...parts: (string | undefined)[]): string {
  const segs = parts.filter((p): p is string => !!p).flatMap((p) => p.split('/')).filter(Boolean);
  const last = parts.filter(Boolean).pop() ?? '';
  // keep a trailing slash only when the last part spells one out (Django "orders/"), not for a bare "/"
  const trailing = last.length > 1 && last.endsWith('/') && segs.length > 0;
  return '/' + segs.join('/') + (trailing ? '/' : '');
}

export function routeParams(path: string): string[] {
  const out: string[] = [];
  for (const m of path.matchAll(/:(\w+)|\{(\w+)[^}]*\}|<(?:\w+:)?(\w+)>|\[\.{0,3}(\w+)\]|\*(\w+)/g)) out.push(m[1] ?? m[2] ?? m[3] ?? m[4] ?? m[5]);
  return out;
}

let routeSeq = 0;
export function mkRoute(framework: string, method: string, path: string, file: string, line: number, extra: Partial<Route> = {}): Route {
  const p = path || '/';
  return {
    id: `route:${framework}:${method}:${p}:${file}:${line}:${routeSeq++}`, kind: 'http', method: method.toUpperCase(), path: p, file, line,
    middleware: [], params: routeParams(p), framework, conf: 'heuristic', ...extra,
  };
}

export function withHandler(r: Route, h: ResolvedName | null, name?: string): Route {
  if (name) r.handler = name;
  if (h) {
    r.handlerSym = h.sym;
    r.hFile = h.file;
    r.hLine = h.line;
    r.hEnd = h.endLine;
    r.conf = h.conf;
  }
  return r;
}

export const HTTP_METHODS = ['get', 'post', 'put', 'patch', 'delete', 'options', 'head', 'all'];
