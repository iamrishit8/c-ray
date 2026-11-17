// L0-git: history features computed from an uploaded .git directory with
// isomorphic-git over an in-memory file system. Runs entirely in the worker.
import { classifyByName, IgnoreMatcher } from '../ingest/filter';
import { CODE_LANGS, detectLanguage } from '../l0/languages';
import { moduleOf } from '../report';
import type { Analysis, ArchSnapshot, CommitInfo, Finding, GitResult } from '../types';
import { DEFAULT_IGNORE } from '../types';
import { decodeText, looksBinary, tick } from '../util';
import { MemFS } from './memfs';

type Git = typeof import('isomorphic-git');

export interface GitDeps {
  /** Runs a light (L0 + L1) analysis of a historical file set. */
  analyzeSnapshot: (files: { path: string; text: string }[], name: string) => Promise<Analysis>;
  progress?: (detail: string) => void;
}

const STOP = new Set('the a an and or of to in for on with from by at is are be this that it as into add adds added fix fixes fixed update updates updated remove removes removed use uses used make makes change changes changed merge branch pull request commit initial wip new some more when not no now also only up out all'.split(' '));
const DIR = '/repo';
const MAX_SNAPSHOTS = 10;
const SNAPSHOT_BYTES = 40 * 1024 * 1024;

export function classifyMessage(msg: string): string {
  const first = msg.split('\n')[0].toLowerCase();
  const conv = /^(feat|fix|refactor|chore|docs|test|tests|perf|build|ci|style|revert)(\([^)]*\))?!?:/.exec(first);
  if (conv) return conv[1] === 'tests' ? 'test' : conv[1];
  if (/^merge\b/.test(first)) return 'merge';
  if (/^revert\b/.test(first)) return 'revert';
  if (/\b(fix|bug|hotfix|patch|issue|crash|error)\b/.test(first)) return 'fix';
  if (/\b(refactor|cleanup|clean up|rename|restructure|simplify|extract|move)\b/.test(first)) return 'refactor';
  if (/\b(test|spec|coverage)\b/.test(first)) return 'test';
  if (/\b(doc|docs|readme|comment)\b/.test(first)) return 'docs';
  if (/\b(bump|upgrade|dependenc|deps|version)\b/.test(first)) return 'chore';
  if (/\b(add|implement|introduce|support|create|feature|new)\b/.test(first)) return 'feat';
  return 'other';
}

async function changedFiles(git: Git, fs: MemFS, oid: string, parentOid: string | undefined): Promise<string[]> {
  const out: string[] = [];
  const trees = parentOid ? [git.TREE({ ref: parentOid }), git.TREE({ ref: oid })] : [git.TREE({ ref: oid })];
  await git.walk({
    fs, dir: DIR, trees,
    map: async (path, entries) => {
      if (path === '.') return true;
      const [a, b] = parentOid ? entries : [null, entries[0]];
      const [ta, tb] = await Promise.all([a?.type(), b?.type()]);
      const [oa, ob] = await Promise.all([a?.oid(), b?.oid()]);
      if (oa === ob) return null; // identical subtree or file: prune
      if (ta === 'tree' || tb === 'tree') return true;
      out.push(path);
      return null;
    },
  });
  return out;
}

async function snapshotAt(git: Git, fs: MemFS, oid: string, label: string, time: number, deps: GitDeps, blobCache: Map<string, string | null>, ignore: IgnoreMatcher): Promise<ArchSnapshot | null> {
  const blobs: { path: string; oid: string }[] = [];
  await git.walk({
    fs, dir: DIR, trees: [git.TREE({ ref: oid })],
    map: async (path, [entry]) => {
      if (path === '.' || !entry) return true;
      const type = await entry.type();
      if (type === 'tree') return ignore.ignores(path, true) ? null : true;
      if (type === 'blob' && !ignore.ignores(path) && !classifyByName(path) && CODE_LANGS.has(detectLanguage(path))) blobs.push({ path, oid: await entry.oid() });
      return null;
    },
  });
  const files: { path: string; text: string }[] = [];
  let bytes = 0;
  for (const b of blobs) {
    let text = blobCache.get(b.oid);
    if (text === undefined) {
      try {
        const { blob } = await git.readBlob({ fs, dir: DIR, oid: b.oid });
        text = blob.length > 1024 * 1024 || looksBinary(blob) ? null : decodeText(blob);
      } catch {
        text = null;
      }
      blobCache.set(b.oid, text);
    }
    if (text === null) continue;
    bytes += text.length;
    if (bytes > SNAPSHOT_BYTES) break;
    files.push({ path: b.path, text });
  }
  if (files.length === 0) return null;
  const a = await deps.analyzeSnapshot(files, label);
  const code = a.files.filter((f) => CODE_LANGS.has(f.lang));
  const depth = (() => {
    for (const d of [1, 2, 3]) if (new Set(code.map((f) => moduleOf(f.path, d))).size >= 4 || d === 3) return d;
    return 2;
  })();
  const mods = new Map<string, { name: string; files: number; loc: number }>();
  const langs: Record<string, number> = {};
  for (const f of code) {
    const k = moduleOf(f.path, depth);
    const m = mods.get(k) ?? { name: k, files: 0, loc: 0 };
    m.files++;
    m.loc += f.loc;
    mods.set(k, m);
    langs[f.lang] = (langs[f.lang] ?? 0) + f.loc;
  }
  const edges = new Map<string, number>();
  for (const e of a.imports) {
    if (e.to < 0) continue;
    const s = moduleOf(a.files[e.from].path, depth);
    const t = moduleOf(a.files[e.to].path, depth);
    if (s !== t) edges.set(`${s}\u0000${t}`, (edges.get(`${s}\u0000${t}`) ?? 0) + 1);
  }
  const fns = a.symbols.filter((s) => s.kind === 'function' || s.kind === 'method');
  return {
    oid, label, time, files: code.length, loc: code.reduce((s, f) => s + f.loc, 0),
    modules: [...mods.values()].sort((x, y) => y.loc - x.loc).slice(0, 60),
    edges: [...edges].map(([k, count]) => ({ from: k.split('\u0000')[0], to: k.split('\u0000')[1], count })).sort((x, y) => y.count - x.count).slice(0, 300),
    hotspots: [...code].sort((x, y) => y.complexity - x.complexity).slice(0, 15).filter((f) => f.complexity > 0).map((f) => ({ file: f.path, complexity: f.complexity, loc: f.loc })),
    avgComplexity: fns.length ? Math.round((fns.reduce((s, f) => s + f.complexity, 0) / fns.length) * 100) / 100 : 0,
    langs,
  };
}

export async function analyzeGit(gitFiles: Map<string, Uint8Array>, a: Analysis, deps: GitDeps): Promise<{ git: GitResult; findings: Finding[] }> {
  if (typeof (globalThis as { Buffer?: unknown }).Buffer === 'undefined') (globalThis as { Buffer?: unknown }).Buffer = (await import('buffer')).Buffer;
  const git: Git = await import('isomorphic-git');
  const fs = new MemFS();
  for (const [path, bytes] of gitFiles) fs.load(`${DIR}/${path}`, bytes);
  const notes: string[] = [];
  const head = await git.resolveRef({ fs, dir: DIR, ref: 'HEAD' });
  const branch = (await git.currentBranch({ fs, dir: DIR }).catch(() => undefined)) || '(detached)';
  const max = a.options.maxGitCommits;
  const log = await git.log({ fs, dir: DIR, ref: head, depth: max + 1 });
  const truncated = log.length > max;
  if (truncated) {
    log.length = max;
    notes.push(`History is long: only the most recent ${max} commits were analysed.`);
  }

  // tags (peel annotated tags to their commit)
  const tags: GitResult['tags'] = [];
  for (const name of await git.listTags({ fs, dir: DIR }).catch(() => [] as string[])) {
    try {
      let oid = await git.resolveRef({ fs, dir: DIR, ref: `refs/tags/${name}` });
      try {
        const t = await git.readTag({ fs, dir: DIR, oid });
        oid = t.tag.object;
      } catch {
        /* lightweight tag */
      }
      tags.push({ name, oid });
    } catch {
      /* unreadable tag */
    }
  }
  const tagsByOid = new Map<string, string[]>();
  for (const t of tags) tagsByOid.set(t.oid, [...(tagsByOid.get(t.oid) ?? []), t.name]);

  // per-commit changed files
  const commits: CommitInfo[] = [];
  const current = new Set(a.files.map((f) => f.path));
  const churn = new Map<string, { commits: number; authors: Map<string, number>; last: number }>();
  const authors = new Map<string, { name: string; email: string; commits: number; files: Set<string> }>();
  const pairs = new Map<string, number>();
  const types: Record<string, number> = {};
  const words = new Map<string, number>();
  let failed = 0;
  for (let i = 0; i < log.length; i++) {
    const c = log[i];
    const who = c.commit.author;
    let files: string[] = [];
    try {
      files = await changedFiles(git, fs, c.oid, c.commit.parent[0]);
    } catch {
      failed++;
    }
    const au = authors.get(who.email) ?? { name: who.name, email: who.email, commits: 0, files: new Set<string>() };
    au.commits++;
    authors.set(who.email, au);
    const isMerge = c.commit.parent.length > 1;
    if (!isMerge) {
      for (const f of files) {
        au.files.add(f);
        const ch = churn.get(f) ?? { commits: 0, authors: new Map<string, number>(), last: 0 };
        ch.commits++;
        ch.authors.set(who.name, (ch.authors.get(who.name) ?? 0) + 1);
        ch.last = Math.max(ch.last, who.timestamp * 1000);
        churn.set(f, ch);
      }
      // co-change: only commits of a reviewable size, only files that still exist
      const live = files.filter((f) => current.has(f) && CODE_LANGS.has(detectLanguage(f)));
      if (live.length >= 2 && live.length <= 25) {
        live.sort();
        for (let x = 0; x < live.length; x++) for (let y = x + 1; y < live.length; y++) pairs.set(`${live[x]}\u0000${live[y]}`, (pairs.get(`${live[x]}\u0000${live[y]}`) ?? 0) + 1);
      }
    }
    const type = classifyMessage(c.commit.message);
    types[type] = (types[type] ?? 0) + 1;
    for (const w of c.commit.message.split('\n')[0].toLowerCase().split(/[^a-z0-9]+/)) if (w.length > 2 && !STOP.has(w) && !/^\d+$/.test(w)) words.set(w, (words.get(w) ?? 0) + 1);
    commits.push({ oid: c.oid, msg: c.commit.message.trim().slice(0, 400), author: who.name, email: who.email, time: who.timestamp * 1000, files: files.slice(0, 60), tags: tagsByOid.get(c.oid) });
    if (i % 20 === 0) {
      deps.progress?.(`commit ${i + 1} of ${log.length}`);
      await tick();
    }
  }
  if (failed) notes.push(`${failed} commit(s) could not be diffed (missing objects, e.g. a shallow clone).`);

  const churnList = [...churn].filter(([f]) => current.has(f)).map(([file, c]) => {
    const top = [...c.authors].sort((x, y) => y[1] - x[1])[0];
    return { file, commits: c.commits, authors: c.authors.size, lastTime: c.last, topAuthor: top[0], topAuthorShare: Math.round((top[1] / c.commits) * 100) / 100 };
  }).sort((x, y) => y.commits - x.commits);

  // bus factor: fewest authors who together "own" (are top author of) more than half of the files
  const owned = new Map<string, number>();
  for (const c of churnList) owned.set(c.topAuthor, (owned.get(c.topAuthor) ?? 0) + 1);
  let acc = 0;
  let bus = 0;
  for (const [, n] of [...owned].sort((x, y) => y[1] - x[1])) {
    acc += n;
    bus++;
    if (acc > churnList.length / 2) break;
  }
  const risky = churnList.filter((c) => c.commits >= 3 && c.topAuthorShare >= 0.8 && CODE_LANGS.has(detectLanguage(c.file))).slice(0, 40).map((c) => ({ file: c.file, author: c.topAuthor, share: c.topAuthorShare, commits: c.commits }));

  const churnOf = new Map(churnList.map((c) => [c.file, c.commits]));
  const minPair = log.length > 60 ? 3 : 2;
  const cochange = [...pairs].filter(([, n]) => n >= minPair).map(([k, count]) => {
    const [x, y] = k.split('\u0000');
    return { a: x, b: y, count, score: Math.round((count / Math.max(1, Math.min(churnOf.get(x) ?? count, churnOf.get(y) ?? count))) * 100) / 100 };
  }).sort((x, y) => y.count * y.score - x.count * x.score).slice(0, 200);

  // architecture snapshots: HEAD, tagged commits and evenly spaced samples
  const snapshots: ArchSnapshot[] = [];
  const chosen = new Map<string, { label: string; time: number }>();
  const short = (oid: string) => oid.slice(0, 7);
  const byOid = new Map(commits.map((c) => [c.oid, c]));
  chosen.set(commits[0].oid, { label: `HEAD (${short(commits[0].oid)})`, time: commits[0].time });
  for (const t of tags.slice(-6)) {
    const c = byOid.get(t.oid);
    if (c && !chosen.has(t.oid)) chosen.set(t.oid, { label: `${t.name} (${short(t.oid)})`, time: c.time });
  }
  const budget = a.files.length > 4000 ? 4 : MAX_SNAPSHOTS;
  const firstParent = commits.filter((c) => c.files.length > 0 || commits.length < 20);
  for (let k = 1; chosen.size < Math.min(budget, firstParent.length) && k <= budget * 3; k++) {
    const c = firstParent[Math.min(firstParent.length - 1, Math.round((k / budget) * (firstParent.length - 1)))];
    if (!chosen.has(c.oid)) chosen.set(c.oid, { label: `${new Date(c.time).toISOString().slice(0, 10)} (${short(c.oid)})`, time: c.time });
  }
  const ignore = new IgnoreMatcher(DEFAULT_IGNORE);
  const blobCache = new Map<string, string | null>();
  let n = 0;
  for (const [oid, info] of [...chosen].sort((x, y) => x[1].time - y[1].time)) {
    deps.progress?.(`architecture snapshot ${++n} of ${chosen.size}`);
    try {
      const s = await snapshotAt(git, fs, oid, info.label, info.time, deps, blobCache, ignore);
      if (s) snapshots.push(s);
    } catch (e) {
      notes.push(`Snapshot at ${info.label} failed: ${e instanceof Error ? e.message : String(e)}`);
    }
    await tick();
  }

  // churn × complexity hotspots
  const findings: Finding[] = [];
  const scored = a.files.filter((f) => CODE_LANGS.has(f.lang) && !f.test && f.complexity > 5 && (churnOf.get(f.path) ?? 0) >= 2).map((f) => ({ f, score: churnOf.get(f.path)! * f.complexity })).sort((x, y) => y.score - x.score).slice(0, 25);
  const topScore = scored[0]?.score ?? 1;
  for (const { f, score } of scored) {
    findings.push({ cat: 'hotspot', sev: score >= topScore * 0.6 ? 'high' : score >= topScore * 0.25 ? 'medium' : 'low', file: f.path, line: 1, conf: 'resolved', value: score, msg: `Hotspot: changed in ${churnOf.get(f.path)} commits and has total complexity ${f.complexity} (score ${score})` });
  }

  return {
    git: {
      branch, head, totalCommits: log.length, truncated, commits, churn: churnList,
      authors: [...authors.values()].map((x) => ({ name: x.name, email: x.email, commits: x.commits, files: x.files.size })).sort((x, y) => y.commits - x.commits),
      busFactor: { overall: bus, risky },
      cochange, messages: { types, keywords: [...words].sort((x, y) => y[1] - x[1]).slice(0, 30).map(([word, count]) => ({ word, count })) },
      tags, snapshots, notes,
    },
    findings,
  };
}

export interface ArchDiff {
  addedModules: ArchSnapshot['modules'];
  removedModules: ArchSnapshot['modules'];
  changedModules: { name: string; filesBefore: number; filesAfter: number; locBefore: number; locAfter: number }[];
  addedEdges: ArchSnapshot['edges'];
  removedEdges: ArchSnapshot['edges'];
  hotspotGrowth: { file: string; before: number; after: number }[];
  loc: [number, number];
  files: [number, number];
  avgComplexity: [number, number];
}

/** Architecture diff between two snapshots (time-travel). */
export function diffSnapshots(before: ArchSnapshot, after: ArchSnapshot): ArchDiff {
  const b = new Map(before.modules.map((m) => [m.name, m]));
  const a = new Map(after.modules.map((m) => [m.name, m]));
  const ek = (e: { from: string; to: string }) => `${e.from}\u0000${e.to}`;
  const be = new Set(before.edges.map(ek));
  const ae = new Set(after.edges.map(ek));
  const hb = new Map(before.hotspots.map((h) => [h.file, h.complexity]));
  return {
    addedModules: after.modules.filter((m) => !b.has(m.name)),
    removedModules: before.modules.filter((m) => !a.has(m.name)),
    changedModules: after.modules.filter((m) => b.has(m.name) && (b.get(m.name)!.loc !== m.loc || b.get(m.name)!.files !== m.files)).map((m) => ({ name: m.name, filesBefore: b.get(m.name)!.files, filesAfter: m.files, locBefore: b.get(m.name)!.loc, locAfter: m.loc })).sort((x, y) => Math.abs(y.locAfter - y.locBefore) - Math.abs(x.locAfter - x.locBefore)),
    addedEdges: after.edges.filter((e) => !be.has(ek(e))),
    removedEdges: before.edges.filter((e) => !ae.has(ek(e))),
    hotspotGrowth: after.hotspots.map((h) => ({ file: h.file, before: hb.get(h.file) ?? 0, after: h.complexity })).filter((h) => h.after !== h.before).sort((x, y) => y.after - y.before - (x.after - x.before)),
    loc: [before.loc, after.loc], files: [before.files, after.files], avgComplexity: [before.avgComplexity, after.avgComplexity],
  };
}
