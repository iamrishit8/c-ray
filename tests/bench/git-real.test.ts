// Git layer on a real repository (packfiles, long history): time + memory.
// Opt-in: GIT_REPO=/path/to/clone [GIT_COMMITS=500] npm run bench:git
// Results are appended to tests/bench/git-real.results.json; numbers go into docs/QUALITY.md.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
import { nodeEnv } from '../../src/core/node-env';
import { runPipeline } from '../../src/core/pipeline';
import { readDir } from '../helpers';

const repo = process.env.GIT_REPO;
const OUT = join(fileURLToPath(new URL('.', import.meta.url)), 'git-real.results.json');

it.skipIf(!repo)('git history on a real repository', async () => {
  const files = readDir(repo!).filter((f) => !f.path.startsWith('node_modules/'));
  const gitFiles = files.filter((f) => f.path.startsWith('.git/'));
  const maxGitCommits = Number(process.env.GIT_COMMITS ?? 500);
  // RSS is noisy (allocator, WASM memory); heap + array buffers show what the JS side retains
  const peak = { rss: 0, heap: 0, buffers: 0 };
  const sample = setInterval(() => {
    const m = process.memoryUsage();
    peak.rss = Math.max(peak.rss, m.rss);
    peak.heap = Math.max(peak.heap, m.heapUsed);
    peak.buffers = Math.max(peak.buffers, m.arrayBuffers);
  }, 25);
  const rss0 = process.memoryUsage().rss;
  const t0 = Date.now();
  const { analysis: a } = await runPipeline({ kind: 'memory', files }, basename(repo!), { maxGitCommits }, nodeEnv({ l2: false }));
  clearInterval(sample);
  expect(a.gitMessage).toBeUndefined();
  const g = a.git!;
  const tests = new Set(a.files.filter((f) => f.test).map((f) => f.path));
  const isTest = (p: string) => tests.has(p);
  const result = {
    repo: basename(repo!), date: new Date().toISOString().slice(0, 10), maxGitCommits,
    files: a.files.length, gitBytesMB: Math.round(gitFiles.reduce((s, f) => s + f.bytes.length, 0) / 1e5) / 10,
    commits: g.totalCommits, truncated: g.truncated, snapshots: g.snapshots.length, authors: g.authors.length,
    cochangePairs: g.cochange.length, hiddenCoupling: g.cochange.filter((c) => c.linked === false).length,
    // breakdown: hand-written .d.ts next to .js (D29) vs a test with no import path to the code
    hiddenWithDts: g.cochange.filter((c) => c.linked === false && (c.a.endsWith('.d.ts') || c.b.endsWith('.d.ts'))).length,
    hiddenTestToCode: g.cochange.filter((c) => c.linked === false && !c.a.endsWith('.d.ts') && !c.b.endsWith('.d.ts') && (isTest(c.a) || isTest(c.b))).length,
    renames: g.renames?.length ?? 0, busFactor: g.busFactor.overall,
    gitStageMs: a.timings['Reading git history'], totalMs: Date.now() - t0,
    rssStartMB: Math.round(rss0 / 1e6), rssPeakMB: Math.round(peak.rss / 1e6), heapPeakMB: Math.round(peak.heap / 1e6), buffersPeakMB: Math.round(peak.buffers / 1e6), notes: g.notes,
  };
  const prev = existsSync(OUT) ? JSON.parse(readFileSync(OUT, 'utf8')) : [];
  writeFileSync(OUT, JSON.stringify([...prev.filter((r: typeof result) => !(r.repo === result.repo && r.maxGitCommits === maxGitCommits)), result], null, 2) + '\n');
  console.log(result, g.cochange.filter((c) => c.linked === false && !c.a.endsWith('.d.ts') && !c.b.endsWith('.d.ts')).map((c) => `${c.a} <> ${c.b}`));
}, 900_000);
