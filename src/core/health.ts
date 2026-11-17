// Hotspots & health: "signals to review", never verdicts. Every finding has a file:line.
import { CODE_LANGS } from './l0/languages';
import { modelOf } from './model';
import type { Stage, StageContext } from './pipeline';
import type { Finding } from './types';
import { basename } from './util';

const WINDOW = 6;
const MIN_TOKENS = 40;
const MAX_CLONES = 300;
const SEV_ORDER = { high: 0, medium: 1, low: 2, info: 3 } as const;

/** Token-based clone detection over normalised line hashes (Type-1/2-ish: whitespace, comments and literals ignored). */
export function findClones(ctx: StageContext): Finding[] {
  const files: { path: string; h: number[]; l: number[]; t: number[] }[] = [];
  let total = 0;
  ctx.units.forEach((u, i) => {
    if (!CODE_LANGS.has(u.lang)) return;
    const lh = ctx.results[i]?.scan.lineHashes;
    if (!lh || lh.length < WINDOW * 3) return;
    const h: number[] = [];
    const l: number[] = [];
    const t: number[] = [];
    for (let k = 0; k < lh.length; k += 3) {
      h.push(lh[k]);
      l.push(lh[k + 1]);
      t.push(lh[k + 2]);
    }
    total += h.length;
    files.push({ path: u.path, h, l, t });
  });
  if (total > 2_500_000) {
    ctx.a.notices.push('Clone detection was skipped: the project has more than 2.5M significant lines.');
    return [];
  }
  // window hash -> occurrences (file index, start index), encoded as fileIdx * 2^22 + start
  const windows = new Map<number, number[]>();
  const SHIFT = 4194304;
  files.forEach((f, fi) => {
    if (f.h.length >= SHIFT) return;
    for (let s = 0; s + WINDOW <= f.h.length; s++) {
      let wh = 17;
      for (let k = 0; k < WINDOW; k++) wh = (Math.imul(wh, 31) + f.h[s + k]) | 0;
      const arr = windows.get(wh);
      if (arr) {
        if (arr.length < 24) arr.push(fi * SHIFT + s);
      } else windows.set(wh, [fi * SHIFT + s]);
    }
  });
  // group matching windows by diagonal (fileA, fileB, startA - startB) and merge adjacent ones
  const diagonals = new Map<string, number[]>();
  for (const occ of windows.values()) {
    if (occ.length < 2 || occ.length >= 24) continue; // 24+ copies = boilerplate, not a clone worth reading
    for (let i = 0; i < occ.length; i++) {
      for (let j = i + 1; j < occ.length; j++) {
        const fa = Math.floor(occ[i] / SHIFT);
        const sa = occ[i] % SHIFT;
        const fb = Math.floor(occ[j] / SHIFT);
        const sb = occ[j] % SHIFT;
        if (fa === fb && Math.abs(sa - sb) < WINDOW) continue; // overlapping self-match
        const key = `${fa}:${fb}:${sa - sb}`;
        const arr = diagonals.get(key);
        if (arr) arr.push(sa);
        else diagonals.set(key, [sa]);
      }
    }
  }
  windows.clear();
  const clones: Finding[] = [];
  for (const [key, starts] of diagonals) {
    const [fa, fb, diff] = key.split(':').map(Number);
    const A = files[fa];
    const B = files[fb];
    starts.sort((x, y) => x - y);
    let runStart = starts[0];
    let prev = starts[0];
    const flush = (s: number, e: number) => {
      const endA = e + WINDOW - 1;
      // verify (guards against hash collisions) and count tokens
      let tokens = 0;
      for (let k = s; k <= endA; k++) {
        if (A.h[k] !== B.h[k - diff]) return;
        tokens += A.t[k];
      }
      if (tokens < MIN_TOKENS) return;
      const lines = A.l[endA] - A.l[s] + 1;
      clones.push({
        cat: 'clone', sev: lines >= 40 ? 'medium' : 'low', file: A.path, line: A.l[s], endLine: A.l[endA], conf: 'heuristic', value: tokens,
        msg: `Duplicated block: ${lines} lines (${tokens} tokens) also appear in ${B.path}:${B.l[s - diff]}`,
        related: [{ file: B.path, line: B.l[s - diff], endLine: B.l[endA - diff] }],
      });
    };
    for (let i = 1; i < starts.length; i++) {
      if (starts[i] === prev) continue;
      if (starts[i] !== prev + 1) {
        flush(runStart, prev);
        runStart = starts[i];
      }
      prev = starts[i];
    }
    flush(runStart, prev);
  }
  clones.sort((x, y) => (y.value ?? 0) - (x.value ?? 0));
  // drop blocks contained in a larger reported block of the same file pair
  const kept: Finding[] = [];
  for (const c of clones) {
    const r = c.related![0];
    if (kept.some((k) => k.file === c.file && k.related![0].file === r.file && k.line <= c.line && k.endLine! >= c.endLine! && k.related![0].line <= r.line && k.related![0].endLine! >= r.endLine!)) continue;
    kept.push(c);
    if (kept.length >= MAX_CLONES) break;
  }
  return kept;
}

export function analyzeHealth(ctx: StageContext): Finding[] {
  const { a } = ctx;
  const m = modelOf(a);
  const out: Finding[] = [];
  // file-level
  for (const f of a.files) {
    if (!CODE_LANGS.has(f.lang)) continue;
    if (f.loc > 1000) out.push({ cat: 'oversize-file', sev: f.loc > 2500 ? 'high' : 'medium', file: f.path, line: 1, conf: 'resolved', value: f.loc, msg: `Large file: ${f.loc} lines` });
  }
  // function-level
  for (const s of a.symbols) {
    if (s.kind !== 'function' && s.kind !== 'method') continue;
    const file = m.path(s.file);
    const exact = a.files[s.file].level === 2 ? 'resolved' : 'heuristic';
    const name = s.parent ? `${s.parent}.${s.name}` : s.name;
    const len = s.endLine - s.line + 1;
    if (len > 80) out.push({ cat: 'oversize-function', sev: len > 300 ? 'high' : len > 150 ? 'medium' : 'low', file, line: s.line, endLine: s.endLine, conf: exact, value: len, msg: `Long function ${name}: ${len} lines` });
    if (s.complexity > 10) out.push({ cat: 'complexity', sev: s.complexity > 30 ? 'high' : s.complexity > 15 ? 'medium' : 'low', file, line: s.line, endLine: s.endLine, conf: exact, value: s.complexity, msg: `High cyclomatic complexity in ${name}: ${s.complexity}` });
    if (s.nesting >= 4) out.push({ cat: 'nesting', sev: s.nesting >= 6 ? 'medium' : 'low', file, line: s.line, endLine: s.endLine, conf: exact, value: s.nesting, msg: `Deep nesting in ${name}: ${s.nesting} levels` });
  }
  // line-scanner results
  ctx.units.forEach((u, i) => {
    const scan = ctx.results[i]?.scan;
    if (!scan) return;
    for (const t of scan.todos) out.push({ cat: 'todo', sev: 'info', file: u.path, line: t.line, conf: 'resolved', msg: `${t.tag}${t.text ? `: ${t.text}` : ''}` });
    const test = m.file(u.path)?.test;
    for (const s of scan.smells) out.push({ cat: s.cat, sev: test && s.sev === 'high' ? 'low' : s.sev, file: u.path, line: s.line, conf: 'heuristic', msg: test ? `${s.msg} (in a test file)` : s.msg });
  });
  out.push(...findClones(ctx));
  // dead exports (L2 only: exact with respect to the analysed files)
  const entryFiles = new Set(a.entries.map((e) => e.file));
  for (const [path, g] of ctx.graphs) {
    if (g.level !== 2 || !g.exports) continue;
    const info = m.file(path);
    if (!info || info.test || entryFiles.has(path) || info.role === 'page' || /\.d\.ts$|\.config\.[cm]?[jt]s$|(^|\/)(index|main)\.[jt]sx?$/.test(path) && info.role === 'entry') continue;
    if (/\.(stories|story)\.[jt]sx?$/.test(path) || /^(vite|webpack|rollup|jest|vitest|playwright|next|tailwind|postcss|babel|eslint)\.config\./.test(basename(path))) continue;
    for (const e of g.exports) {
      if (e.used || e.isPublic) continue;
      const d = g.defs[e.def];
      out.push({ cat: 'dead-export', sev: 'low', file: path, line: d.line, endLine: d.endLine, conf: 'resolved', msg: `Export "${e.name}" (${d.kind}) is not referenced by any other analysed file` });
    }
  }
  out.sort((x, y) => SEV_ORDER[x.sev] - SEV_ORDER[y.sev] || (x.file < y.file ? -1 : x.file > y.file ? 1 : x.line - y.line));
  return out;
}

export const healthStage: Stage = {
  name: 'Checking health signals',
  phase: 'deep',
  run(ctx) {
    ctx.a.findings = analyzeHealth(ctx);
  },
};
