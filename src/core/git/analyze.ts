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
/** Shared arguments for every isomorphic-git call. `cache` keeps parsed packfile indexes
 *  between calls; without it each call re-reads them (several times slower on real repos). */
interface Repo { fs: MemFS; dir: string; cache: object }

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

/** Is there an import path between two files (either direction, at most `hops` steps) at HEAD?
 *  Co-change without one is hidden coupling. Bounded BFS from each queried file. */
function importLinks(a: Analysis, hops = 4): (x: string, y: string) => boolean {
  const idx = new Map(a.files.map((f, i) => [f.path, i]));
  const out = new Map<number, number[]>();
  for (const e of a.imports) if (e.to >= 0 && e.to !== e.from) out.set(e.from, [...(out.get(e.from) ?? []), e.to]);
  const reach = new Map<number, Set<number>>();
  const reachable = (from: number) => {
    let seen = reach.get(from);
    if (seen) return seen;
    seen = new Set([from]);
    let frontier = [from];
    for (let d = 0; d < hops && frontier.length; d++) {
      const next: number[] = [];
      for (const n of frontier) for (const m of out.get(n) ?? []) if (!seen.has(m)) (seen.add(m), next.push(m));
      frontier = next;
    }
    reach.set(from, seen);
    return seen;
  };
  return (x, y) => {
    const i = idx.get(x);
    const j = idx.get(y);
    return i !== undefined && j !== undefined && (reachable(i).has(j) || reachable(j).has(i));
  };
}

async function changedFiles(git: Git, repo: Repo, oid: string, parentOid: string | undefined): Promise<string[]> {
  const out: string[] = [];
  const trees = parentOid ? [git.TREE({ ref: parentOid }), git.TREE({ ref: oid })] : [git.TREE({ ref: oid })];
  await git.walk({
    ...repo, trees,
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

/** Module grouping depth: the shallowest that yields at least 4 modules. Chosen once (at HEAD)
 *  so every snapshot groups files the same way and diffs compare like with like. */
function moduleDepth(paths: string[]): number {
  for (const d of [1, 2]) if (new Set(paths.map((p) => moduleOf(p, d))).size >= 4) return d;
  return 3;
}

async function snapshotAt(git: Git, repo: Repo, oid: string, label: string, time: number, depth: number, deps: GitDeps, blobCache: Map<string, string | null>, ignore: IgnoreMatcher): Promise<ArchSnapshot | null> {
  const blobs: { path: string; oid: string }[] = [];
  await git.walk({
    ...repo, trees: [git.TREE({ ref: oid })],
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
        const { blob } = await git.readBlob({ ...repo, oid: b.oid });
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
  const repo: Repo = { fs, dir: DIR, cache: {} };
  const notes: string[] = [];
  const head = await git.resolveRef({ ...repo, ref: 'HEAD' });
  const branch = (await git.currentBranch({ ...repo }).catch(() => undefined)) || '(detached)';
  const max = a.options.maxGitCommits;
  const log = await git.log({ ...repo, ref: head, depth: max + 1 });
  if (log.length === 0) throw new Error('the repository has no commits');
  const truncated = log.length > max;
  if (truncated) {
    log.length = max;
    notes.push(`History is long: only the most recent ${max} commits were analysed.`);
  }

  // tags (peel annotated tags to their commit)
  const tags: GitResult['tags'] = [];
  for (const name of await git.listTags({ ...repo }).catch(() => [] as string[])) {
    try {
      let oid = await git.resolveRef({ ...repo, ref: `refs/tags/${name}` });
      try {
        const t = await git.readTag({ ...repo, oid });
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
  const isTest = new Set(a.files.filter((f) => f.test).map((f) => f.path));
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
      files = await changedFiles(git, repo, c.oid, c.commit.parent[0]);
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
        // test ↔ test pairs are skipped: a sweep across a test suite is not coupling
        for (let x = 0; x < live.length; x++) for (let y = x + 1; y < live.length; y++) if (!(isTest.has(live[x]) && isTest.has(live[y]))) pairs.set(`${live[x]}\u0000${live[y]}`, (pairs.get(`${live[x]}\u0000${live[y]}`) ?? 0) + 1);
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
    // ties go to the alphabetically first author so results don't depend on walk order
    const top = [...c.authors].sort((x, y) => y[1] - x[1] || (x[0] < y[0] ? -1 : 1))[0];
    return { file, commits: c.commits, authors: c.authors.size, lastTime: c.last, topAuthor: top[0], topAuthorShare: Math.round((top[1] / c.commits) * 100) / 100 };
  }).sort((x, y) => y.commits - x.commits);

  // bus factor: fewest authors who together "own" (are top author of) more than half of the files
  const owned = new Map<string, number>();
  for (const c of churnList) owned.set(c.topAuthor, (owned.get(c.topAuthor) ?? 0) + 1);
  let acc = 0;
  let bus = 0;
  for (const [, n] of [...owned].sort((x, y) => y[1] - x[1] || (x[0] < y[0] ? -1 : 1))) {
    acc += n;
    bus++;
    if (acc > churnList.length / 2) break;
  }
  const risky = churnList.filter((c) => c.commits >= 3 && c.topAuthorShare >= 0.8 && CODE_LANGS.has(detectLanguage(c.file))).slice(0, 40).map((c) => ({ file: c.file, author: c.topAuthor, share: c.topAuthorShare, commits: c.commits }));

  const churnOf = new Map(churnList.map((c) => [c.file, c.commits]));
  const minPair = log.length > 60 ? 3 : 2;
  const linked = importLinks(a);
  const cochange = [...pairs].filter(([, n]) => n >= minPair).map(([k, count]) => {
    const [x, y] = k.split('\u0000');
    return { a: x, b: y, count, score: Math.round((count / Math.max(1, Math.min(churnOf.get(x) ?? count, churnOf.get(y) ?? count))) * 100) / 100, linked: linked(x, y) };
  }).sort((x, y) => y.count * y.score - x.count * x.score).slice(0, 200);

  // architecture snapshots: HEAD, tagged commits and evenly spaced samples
  const snapshots: ArchSnapshot[] = [];
  const chosen = new Map<string, { label: string; time: number }>();
  const short = (oid: string) => oid.slice(0, 7);
  const byOid = new Map(commits.map((c) => [c.oid, c]));
  // big projects get fewer snapshots: each one re-parses the tree at that commit
  const budget = a.files.length > 4000 ? 4 : MAX_SNAPSHOTS;
  chosen.set(commits[0].oid, { label: `HEAD (${short(commits[0].oid)})`, time: commits[0].time });
  // most recent tags within the analysed window (listTags is alphabetical, not chronological)
  const inWindow = tags.filter((t) => byOid.has(t.oid)).sort((x, y) => byOid.get(x.oid)!.time - byOid.get(y.oid)!.time);
  for (const t of inWindow.slice(-Math.min(6, budget - 2))) {
    if (!chosen.has(t.oid)) chosen.set(t.oid, { label: `${t.name} (${short(t.oid)})`, time: byOid.get(t.oid)!.time });
  }
  // the oldest analysed commit is the natural time-travel baseline
  const oldest = commits[commits.length - 1];
  if (!chosen.has(oldest.oid)) chosen.set(oldest.oid, { label: `${new Date(oldest.time).toISOString().slice(0, 10)} (${short(oldest.oid)})`, time: oldest.time });
  const firstParent = commits.filter((c) => c.files.length > 0 || commits.length < 20);
  for (let k = 1; chosen.size < Math.min(budget, firstParent.length) && k <= budget * 3; k++) {
    const c = firstParent[Math.min(firstParent.length - 1, Math.round((k / budget) * (firstParent.length - 1)))];
    if (!chosen.has(c.oid)) chosen.set(c.oid, { label: `${new Date(c.time).toISOString().slice(0, 10)} (${short(c.oid)})`, time: c.time });
  }
  const ignore = new IgnoreMatcher(DEFAULT_IGNORE);
  const depth = moduleDepth(a.files.filter((f) => CODE_LANGS.has(f.lang)).map((f) => f.path));
  const blobCache = new Map<string, string | null>();
  let n = 0;
  for (const [oid, info] of [...chosen].sort((x, y) => x[1].time - y[1].time)) {
    deps.progress?.(`architecture snapshot ${++n} of ${chosen.size}`);
    try {
      const s = await snapshotAt(git, repo, oid, info.label, info.time, depth, deps, blobCache, ignore);
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

export { diffSnapshots, type ArchDiff } from './diff';
