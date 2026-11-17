// Request / flow tracer: from an entry point, follow calls through middleware,
// handlers, services, data access and external calls. Every step carries a
// file:line and a confidence; nothing is invented between steps.
import { modelOf } from './model';
import type { Analysis, Confidence, EntryPoint, Role } from './types';

export type StepKind = 'entry' | 'middleware' | 'handler' | 'call' | 'db' | 'http' | 'queue' | 'unresolved';

export interface FlowStep {
  id: number;
  parent: number;
  depth: number;
  kind: StepKind;
  label: string;
  file: string;
  line: number;
  endLine?: number;
  role?: Role;
  sym?: number;
  conf: Confidence;
  /** Where the step was triggered from (call site). */
  via?: { file: string; line: number };
  note?: string;
}

export interface Flow {
  entry: EntryPoint;
  steps: FlowStep[];
  truncated: boolean;
  files: string[];
}

export interface FlowOptions {
  maxDepth?: number;
  maxSteps?: number;
}

export function traceFlow(a: Analysis, entryId: string, opts: FlowOptions = {}): Flow | null {
  const entry = a.entries.find((e) => e.id === entryId);
  if (!entry) return null;
  const m = modelOf(a);
  const maxDepth = opts.maxDepth ?? 8;
  const maxSteps = opts.maxSteps ?? 250;
  const steps: FlowStep[] = [];
  let truncated = false;
  const expanded = new Set<string>();
  const factsByFile = new Map<string, Analysis['facts']>();
  for (const f of a.facts) {
    if (f.kind !== 'db' && f.kind !== 'http-call' && f.kind !== 'queue-pub') continue;
    const arr = factsByFile.get(f.file);
    if (arr) arr.push(f);
    else factsByFile.set(f.file, [f]);
  }
  const unresByFile = new Map<string, Analysis['unresolved']>();
  for (const u of a.unresolved) {
    if (u.kind === 'import') continue;
    const arr = unresByFile.get(u.file);
    if (arr) arr.push(u);
    else unresByFile.set(u.file, [u]);
  }
  const refsByFile = new Map<number, Analysis['refs']>();
  for (const r of a.refs) {
    if (r.kind !== 'call' && r.kind !== 'new') continue;
    const arr = refsByFile.get(r.file);
    if (arr) arr.push(r);
    else refsByFile.set(r.file, [r]);
  }

  const push = (s: Omit<FlowStep, 'id'>): number => {
    if (steps.length >= maxSteps) {
      truncated = true;
      return -1;
    }
    steps.push({ ...s, id: steps.length });
    return steps.length - 1;
  };

  /** Expand the body located at file:[from,to]: calls, data access, external calls, unresolved spots. */
  const expand = (file: string, from: number, to: number, parent: number, depth: number, selfSym: number) => {
    const key = `${file}:${from}-${to}`;
    if (expanded.has(key)) {
      if (parent >= 0) steps[parent].note = 'already expanded above';
      return;
    }
    expanded.add(key);
    if (depth > maxDepth) {
      truncated = true;
      return;
    }
    const fi = m.fileIdx.get(file);
    if (fi === undefined) return;
    type Ev = { line: number; run: () => void };
    const events: Ev[] = [];
    const seenCall = new Set<number>();
    for (const r of refsByFile.get(fi) ?? []) {
      if (r.line < from || r.line > to || r.to === selfSym) continue;
      const t = a.symbols[r.to];
      if (t.kind !== 'function' && t.kind !== 'method' && t.kind !== 'class') continue;
      // skip references to definitions nested inside the body we are expanding
      if (t.file === fi && t.line >= from && t.endLine <= to) continue;
      if (seenCall.has(r.to)) continue;
      seenCall.add(r.to);
      events.push({
        line: r.line,
        run: () => {
          const tf = m.path(t.file);
          const id = push({ parent, depth, kind: 'call', label: m.symLabel(r.to), file: tf, line: t.line, endLine: t.endLine, role: a.files[t.file].role, sym: r.to, conf: r.conf, via: { file, line: r.line } });
          if (id >= 0) expand(tf, t.line, t.endLine, id, depth + 1, r.to);
        },
      });
    }
    for (const f of factsByFile.get(file) ?? []) {
      if (f.line < from || f.line > to) continue;
      events.push({
        line: f.line,
        run: () => void push({ parent, depth, kind: f.kind === 'db' ? 'db' : f.kind === 'http-call' ? 'http' : 'queue', label: f.kind === 'db' ? `${f.op === 'write' ? 'write' : 'read'} ${f.target ?? 'database'} — ${f.detail}` : f.detail, file, line: f.line, role: a.files[fi].role, conf: f.conf }),
      });
    }
    for (const u of unresByFile.get(file) ?? []) {
      if (u.line < from || u.line > to) continue;
      events.push({ line: u.line, run: () => void push({ parent, depth, kind: 'unresolved', label: `cannot follow statically: ${u.detail}`, file, line: u.line, conf: 'unresolved' }) });
    }
    events.sort((x, y) => x.line - y.line);
    for (const e of events) e.run();
  };

  const route = entry.routeId ? a.routes.find((r) => r.id === entry.routeId) : undefined;
  const root = push({ parent: -1, depth: 0, kind: 'entry', label: entry.label, file: route?.file ?? entry.file, line: route?.line ?? entry.line, conf: entry.conf, role: m.file(route?.file ?? entry.file)?.role });
  if (route) {
    for (const mw of route.middleware) {
      if (mw.sym !== undefined) {
        const s = a.symbols[mw.sym];
        const id = push({ parent: root, depth: 1, kind: 'middleware', label: mw.name, file: m.path(s.file), line: s.line, endLine: s.endLine, role: 'middleware', sym: mw.sym, conf: a.files[s.file].level === 2 ? 'resolved' : 'heuristic', via: { file: route.file, line: route.line } });
        if (id >= 0) expand(m.path(s.file), s.line, s.endLine, id, 2, mw.sym);
      } else {
        push({ parent: root, depth: 1, kind: 'middleware', label: mw.name, file: mw.file ?? route.file, line: mw.line ?? route.line, role: 'middleware', conf: mw.file ? 'heuristic' : 'unresolved', note: mw.file ? undefined : 'declared by name; its implementation is not in the analysed files' });
      }
    }
    if (route.hFile && route.hLine) {
      const id = push({ parent: root, depth: 1, kind: 'handler', label: route.handlerSym !== undefined ? m.symLabel(route.handlerSym) : route.handler ?? '(handler)', file: route.hFile, line: route.hLine, endLine: route.hEnd, role: m.file(route.hFile)?.role, sym: route.handlerSym, conf: route.conf, via: { file: route.file, line: route.line } });
      if (id >= 0) expand(route.hFile, route.hLine, route.hEnd ?? route.hLine, id, 2, route.handlerSym ?? -1);
    } else {
      push({ parent: root, depth: 1, kind: 'unresolved', label: `handler ${route.handler ?? ''} could not be located in the analysed files`, file: route.file, line: route.line, conf: 'unresolved' });
    }
  } else {
    const fi = m.fileIdx.get(entry.file);
    if (fi !== undefined) {
      if (entry.sym !== undefined) {
        const s = a.symbols[entry.sym];
        expand(entry.file, s.line, s.endLine, root, 1, entry.sym);
      } else if (entry.endLine !== undefined) expand(entry.file, entry.line, entry.endLine, root, 1, -1);
      else {
        const si = m.symbolAt(fi, entry.line);
        if (si >= 0 && a.symbols[si].line === entry.line) expand(entry.file, a.symbols[si].line, a.symbols[si].endLine, root, 1, si);
        else expand(entry.file, 1, Math.max(1, a.files[fi].loc), root, 1, -1);
      }
    }
  }
  return { entry, steps, truncated, files: [...new Set(steps.map((s) => s.file))] };
}

/** Mermaid sequence-ish flowchart for reports. */
export function flowToMermaid(a: Analysis, flow: Flow, max = 40): string {
  const lines = ['flowchart TD'];
  const esc = (s: string) => s.replace(/["`\[\]{}()<>|#;]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 70);
  const shown = flow.steps.slice(0, max);
  for (const s of shown) {
    const text = `${esc(s.label)}<br/>${esc(s.file.split('/').slice(-2).join('/'))}:${s.line}`;
    lines.push(s.kind === 'db' ? `  s${s.id}[("${text}")]` : s.kind === 'http' || s.kind === 'queue' ? `  s${s.id}>"${text}"]` : s.kind === 'entry' ? `  s${s.id}(["${text}"])` : `  s${s.id}["${text}"]`);
  }
  for (const s of shown) if (s.parent >= 0) lines.push(`  s${s.parent} ${s.conf === 'resolved' ? '-->' : '-.->'} s${s.id}`);
  if (flow.steps.length > max) lines.push(`  more["… ${flow.steps.length - max} more steps"]`);
  return lines.join('\n');
}
