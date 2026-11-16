// The analysis pipeline. Pure and isomorphic: runs inside the browser worker
// and inside Node (tests, benchmarks). Each stage degrades independently — a
// failing stage records a notice and the pipeline carries on.
import { ingest, type InputSource } from './ingest/ingest';
import { classifyConfig, classifyDoc, detectTech, isManifest, parseManifest } from './l0/l0';
import { CODE_LANGS, isTestPath } from './l0/languages';
import { buildOrientation, detectGenericEntries } from './orientation';
import { inferRole } from './roles';
import { scanFile } from './scan';
import {
  ANALYSIS_VERSION, DEFAULT_OPTIONS,
  type Analysis, type AnalysisOptions, type FileInfo, type FileParse, type FileScan, type FileUnit, type L0Result, type Progress,
} from './types';
import { dirname, hashString, pct } from './util';

export interface FileResult {
  scan: FileScan;
  parse: FileParse | null;
}

export interface CachedFile extends FileResult {
  hash: string;
}

export interface PipelineEnv {
  /** Scan + L1-parse a batch of files (worker pool in the browser, inline in Node). */
  processFiles?: (units: FileUnit[], opts: AnalysisOptions, onFile: (path: string) => void) => Promise<FileResult[]>;
  /** Per-file results from a previous run of the same project, keyed by path. */
  loadCache?: () => Promise<Map<string, CachedFile>>;
  saveCache?: (entries: Map<string, CachedFile>) => Promise<void>;
  /** Extra stages plugged in by later layers; each mutates the analysis in place. */
  stages?: Stage[];
}

export interface StageContext {
  a: Analysis;
  units: FileUnit[];
  unitByPath: Map<string, FileUnit>;
  results: FileResult[];
  gitFiles: Map<string, Uint8Array> | null;
  opts: AnalysisOptions;
  progress: (phase: string, detail?: string) => void;
}

export interface Stage {
  name: string;
  /** 'graph' stages run before the second snapshot, 'deep' stages before the final one. */
  phase: 'graph' | 'deep';
  run: (ctx: StageContext) => Promise<void> | void;
}

export type PipelineEvent =
  | { type: 'progress'; progress: Progress }
  | { type: 'snapshot'; analysis: Analysis };

export interface PipelineOutput {
  analysis: Analysis;
  units: FileUnit[];
}

export function emptyAnalysis(name: string, opts: AnalysisOptions): Analysis {
  return {
    version: ANALYSIS_VERSION, projectId: projectIdFor(name), name, createdAt: Date.now(), mode: 'project', stage: 'l0',
    contentHash: '', options: opts, files: [], skipped: [], notices: [],
    coverage: { discovered: 0, analyzed: 0, skipped: 0, pctFiles: 100, pctBytes: 100, l1Files: 0, l2Files: 0 },
    l0: { languages: [], manifests: [], configs: [], tech: [], docs: [], tree: { dirs: 0, maxDepth: 0 } },
    symbols: [], imports: [], refs: [], unresolved: [], frameworks: [], routes: [], entries: [], facts: [],
    schema: { entities: [], relations: [], access: [] },
    deps: { cycles: [], metrics: [], godModules: [], violations: [], packages: [] },
    findings: [], git: null, decisions: [],
    orientation: { summary: '', styles: [], readFirst: [] },
    timings: {}, reused: { files: 0, total: 0 },
  };
}

/** Projects are identified by name so re-dropping the same project reuses its cache. */
export function projectIdFor(name: string): string {
  return 'p_' + hashString(name.trim().toLowerCase());
}

export function buildL0(units: FileUnit[], files: FileInfo[]): L0Result {
  const langs = new Map<string, { lang: string; files: number; loc: number; bytes: number }>();
  const dirs = new Set<string>();
  let maxDepth = 0;
  for (const f of files) {
    const l = langs.get(f.lang) ?? { lang: f.lang, files: 0, loc: 0, bytes: 0 };
    l.files++;
    l.loc += f.loc;
    l.bytes += f.size;
    langs.set(f.lang, l);
    let d = dirname(f.path);
    maxDepth = Math.max(maxDepth, f.path.split('/').length - 1);
    while (d && !dirs.has(d)) {
      dirs.add(d);
      d = dirname(d);
    }
  }
  const l0: L0Result = {
    languages: [...langs.values()].sort((a, b) => (CODE_LANGS.has(b.lang) ? 1 : 0) - (CODE_LANGS.has(a.lang) ? 1 : 0) || b.loc - a.loc),
    manifests: [], configs: [], tech: [], docs: [], tree: { dirs: dirs.size, maxDepth },
  };
  for (const u of units) {
    try {
      if (isManifest(u.path)) {
        const m = parseManifest(u.path, u.text);
        if (m) l0.manifests.push(m);
      }
      const c = classifyConfig(u.path, u.text);
      if (c) l0.configs.push(c);
      const d = classifyDoc(u.path, u.text);
      if (d) l0.docs.push(d);
    } catch {
      /* a malformed manifest must never break the run */
    }
  }
  l0.tech = detectTech(l0.manifests, l0.configs, l0.languages);
  return l0;
}

function inlineProcess(units: FileUnit[]): FileResult[] {
  return units.map((u) => ({ scan: scanFile(u.text, u.lang, u.path), parse: null }));
}

export async function runPipeline(
  source: InputSource,
  name: string,
  options: Partial<AnalysisOptions> = {},
  env: PipelineEnv = {},
  emit: (e: PipelineEvent) => void = () => {},
): Promise<PipelineOutput> {
  const opts: AnalysisOptions = { ...DEFAULT_OPTIONS, ...options };
  const a = emptyAnalysis(name, opts);
  const t0 = Date.now();
  const prog: Progress = { phase: 'Reading files', discovered: 0, parsed: 0, skipped: 0, total: 0 };
  let lastEmit = 0;
  const progress = (patch: Partial<Progress>, force = false) => {
    Object.assign(prog, patch);
    const now = Date.now();
    if (force || now - lastEmit > 80) {
      lastEmit = now;
      emit({ type: 'progress', progress: { ...prog } });
    }
  };
  const time = async (key: string, fn: () => Promise<void> | void) => {
    const s = Date.now();
    try {
      await fn();
    } catch (e) {
      a.notices.push(`Stage "${key}" failed and was skipped: ${e instanceof Error ? e.message : String(e)}`);
    }
    a.timings[key] = (a.timings[key] ?? 0) + (Date.now() - s);
  };

  // ---- 1. ingestion ----
  const ing = await ingest(source, opts, (p) => progress(p));
  a.timings.ingest = Date.now() - t0;
  const units = ing.units;
  a.skipped = ing.skipped;
  a.notices.push(...ing.notices);
  if (ing.limited) a.notices.push(ing.limited);
  a.mode = units.length === 1 && ing.discovered <= 1 ? 'file' : 'project';
  progress({ phase: 'Scanning', discovered: ing.discovered, skipped: ing.discovered - units.length, total: units.length, parsed: 0 }, true);

  // ---- 2. per-file scan + L1 parse, reusing cached results for unchanged files ----
  const results: FileResult[] = new Array(units.length);
  await time('parse', async () => {
    const cache = env.loadCache ? await env.loadCache().catch(() => new Map<string, CachedFile>()) : new Map<string, CachedFile>();
    const todo: FileUnit[] = [];
    const todoIdx: number[] = [];
    units.forEach((u, i) => {
      const c = cache.get(u.path);
      if (c && c.hash === u.hash) {
        results[i] = { scan: c.scan, parse: c.parse };
        a.reused.files++;
      } else {
        todo.push(u);
        todoIdx.push(i);
      }
    });
    a.reused.total = units.length;
    let done = a.reused.files;
    progress({ phase: 'Parsing', parsed: done }, true);
    const fresh = env.processFiles
      ? await env.processFiles(todo, opts, (path) => progress({ parsed: ++done, detail: path }))
      : inlineProcess(todo);
    fresh.forEach((r, k) => (results[todoIdx[k]] = r));
    if (env.saveCache) {
      const next = new Map<string, CachedFile>();
      units.forEach((u, i) => next.set(u.path, { hash: u.hash, ...results[i] }));
      await env.saveCache(next).catch(() => a.notices.push('Could not store the incremental parse cache (storage unavailable or full).'));
    }
  });

  // ---- 3. L0 ----
  await time('l0', () => {
    a.files = units.map((u, i): FileInfo => {
      const r = results[i] ?? { scan: scanFile(u.text, u.lang, u.path), parse: null };
      results[i] = r;
      const defs = r.parse?.defs ?? [];
      const fns = defs.filter((d) => d.kind === 'function' || d.kind === 'method');
      return {
        path: u.path, size: u.size, loc: r.scan.loc, sloc: r.scan.sloc, lang: u.lang, hash: u.hash,
        role: inferRole(u.path, u.lang), roleConf: 'heuristic', roleSource: 'generic',
        level: r.parse && !r.parse.error ? 1 : 0, test: isTestPath(u.path),
        parseError: r.parse?.error,
        complexity: fns.reduce((s, d) => s + d.complexity, 0),
        maxComplexity: fns.reduce((s, d) => Math.max(s, d.complexity), 0),
        maxNesting: defs.reduce((s, d) => Math.max(s, d.nesting), 0),
        symbols: defs.length,
      };
    });
    a.contentHash = hashString(units.map((u) => u.path + ':' + u.hash).join('|'));
    a.l0 = buildL0(units, a.files);
    a.coverage = {
      discovered: ing.discovered, analyzed: units.length, skipped: ing.discovered - units.length,
      pctFiles: pct(units.length, ing.discovered), pctBytes: pct(ing.analyzedBytes, ing.totalBytes),
      l1Files: a.files.filter((f) => f.level >= 1).length, l2Files: 0, limited: ing.limited,
    };
    a.entries = detectGenericEntries(a, units);
    buildOrientation(a);
  });
  if (!ing.gitFiles && opts.enableGit) a.gitMessage = 'Upload including the .git folder to enable history features.';
  emit({ type: 'snapshot', analysis: a });

  // ---- 4/5. plugged-in stages ----
  const ctx: StageContext = {
    a, units, unitByPath: new Map(units.map((u) => [u.path, u])), results, gitFiles: ing.gitFiles, opts,
    progress: (phase, detail) => progress({ phase, detail }, true),
  };
  const stages = env.stages ?? [];
  for (const s of stages.filter((x) => x.phase === 'graph')) {
    ctx.progress(s.name);
    await time(s.name, () => s.run(ctx));
  }
  await time('orientation', () => {
    buildOrientation(a);
  });
  if (stages.length) {
    a.stage = 'graph';
    emit({ type: 'snapshot', analysis: a });
  }
  for (const s of stages.filter((x) => x.phase === 'deep')) {
    ctx.progress(s.name);
    await time(s.name, () => s.run(ctx));
  }
  a.stage = 'done';
  await time('orientation', () => {
    buildOrientation(a);
  });
  a.timings.total = Date.now() - t0;
  progress({ phase: 'Done', parsed: units.length }, true);
  emit({ type: 'snapshot', analysis: a });
  return { analysis: a, units };
}
