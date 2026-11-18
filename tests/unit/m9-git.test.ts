// M9: git history engine against the planted history of the git-history fixture.
import { beforeAll, describe, expect, it } from 'vitest';
import { classifyMessage, diffSnapshots, lineSimilarity } from '../../src/core/git/analyze';
import { nodeEnv } from '../../src/core/node-env';
import { runPipeline } from '../../src/core/pipeline';
import { buildSections, fullMarkdown } from '../../src/core/report';
import type { Analysis, GitResult } from '../../src/core/types';
import { ALICE, buildRepo, gitHistoryFiles, gitMovesFiles } from '../git-fixture';
import { analyzeMem, groundTruth } from '../helpers';

const truth = groundTruth('git-history');

async function analyze(opts = {}, files?: { path: string; bytes: Uint8Array }[]): Promise<Analysis> {
  const src = files ?? (await gitHistoryFiles());
  return (await runPipeline({ kind: 'memory', files: src }, 'git-history', opts, nodeEnv({ l2: false }))).analysis;
}

describe('git history (planted truth)', () => {
  let a: Analysis;
  let g: GitResult;
  beforeAll(async () => {
    a = await analyze();
    g = a.git!;
  }, 120_000);

  it('reads the repository', () => {
    expect(a.gitMessage).toBeUndefined();
    expect(g).toBeTruthy();
    expect(g.branch).toBe(truth.branch);
    expect(g.totalCommits).toBe(truth.totalCommits);
    expect(g.truncated).toBe(false);
    expect(g.head).toBe(g.commits[0].oid);
    expect(g.notes).toEqual([]);
  });

  it('counts authors and the files they touched', () => {
    expect(g.authors.map(({ name, email, commits, files }) => ({ name, email, commits, files }))).toEqual(truth.authors);
  });

  it('computes churn per file', () => {
    expect(g.churn.map((c) => c.file).sort()).toEqual(Object.keys(truth.churn).sort());
    for (const [file, t] of Object.entries<any>(truth.churn)) {
      const c = g.churn.find((x) => x.file === file)!;
      expect({ commits: c.commits, authors: c.authors, topAuthor: c.topAuthor, topAuthorShare: c.topAuthorShare }, file).toEqual(t);
    }
    // sorted by commits, most changed first
    expect(g.churn[0].commits).toBe(4);
    const report = g.churn.find((c) => c.file === 'src/legacy/report.ts')!;
    expect(new Date(report.lastTime).toISOString().slice(0, 10)).toBe('2026-01-15');
  });

  it('computes the bus factor and single-owner files', () => {
    expect(g.busFactor.overall).toBe(truth.busFactor);
    expect(g.busFactor.risky).toEqual(truth.busFactorRisky);
  });

  it('finds the co-changing pair and flags it as hidden coupling (no import between them)', () => {
    expect(g.cochange).toEqual(truth.cochange);
  });

  it('marks co-change pairs that do import each other as linked', async () => {
    // same history plus a commit where pricing.ts starts importing tax.ts
    const files = (await gitHistoryFiles()).map((f) => f.path === 'src/services/pricing.ts' ? { ...f, bytes: new TextEncoder().encode("import { taxRate } from './tax';\n" + new TextDecoder().decode(f.bytes)) } : f);
    const b = await analyze({}, files);
    expect(b.git!.cochange[0]).toMatchObject({ a: 'src/services/pricing.ts', b: 'src/services/tax.ts', linked: true });
  });

  it('counts an indirect import path (within 4 hops) as linked', async () => {
    const enc = new TextEncoder();
    const files = (await gitHistoryFiles()).map((f) => f.path === 'src/services/pricing.ts' ? { ...f, bytes: enc.encode("import { taxRate } from './rates';\n" + new TextDecoder().decode(f.bytes)) } : f);
    files.push({ path: 'src/services/rates.ts', bytes: enc.encode("export { taxRate } from './tax';\n") });
    const b = await analyze({}, files);
    expect(b.git!.cochange[0]).toMatchObject({ a: 'src/services/pricing.ts', b: 'src/services/tax.ts', linked: true });
  });

  it('classifies commit messages', () => {
    expect(g.messages.types).toEqual(truth.messageTypes);
    expect(g.messages.keywords.map((k) => k.word)).toContain('report');
    expect(g.messages.keywords.find((k) => k.word === 'pricing')!.count).toBe(5);
  });

  it('peels the annotated tag to its commit', () => {
    expect(g.tags.map((t) => t.name)).toEqual(truth.tags.map((t: any) => t.name));
    const tagged = g.commits.find((c) => c.oid === g.tags[0].oid)!;
    expect(tagged.msg).toBe(truth.tags[0].commitMessage);
    expect(tagged.tags).toEqual(['v1.0']);
  });

  it('takes architecture snapshots at the oldest commit, the tag and HEAD', () => {
    const s = g.snapshots;
    expect(s.length).toBe(truth.snapshots.count);
    expect(s.map((x) => x.time)).toEqual([...s.map((x) => x.time)].sort((x, y) => x - y));
    expect(s[0].label.startsWith(truth.snapshots.oldestLabelStartsWith)).toBe(true);
    for (const l of truth.snapshots.labelsInclude) expect(s.some((x) => x.label.startsWith(l)), l).toBe(true);
    expect(s[s.length - 1].label.startsWith('HEAD')).toBe(true);
  });

  it('diffs the oldest snapshot against HEAD', () => {
    const t = truth.snapshots.oldestToHead;
    const d = diffSnapshots(g.snapshots[0], g.snapshots[g.snapshots.length - 1]);
    expect(d.addedModules.map((m) => m.name).sort()).toEqual(t.addedModules);
    expect(d.removedModules.map((m) => m.name)).toEqual(t.removedModules);
    expect(d.addedEdges.map((e) => [e.from, e.to]).sort()).toEqual(t.addedEdges);
    expect(d.removedEdges).toEqual(t.removedEdges);
    expect(d.files).toEqual(t.files);
    expect(d.loc[1]).toBeGreaterThan(d.loc[0]);
    // pricing.ts gained branches over time
    expect(d.hotspotGrowth.find((h) => h.file === 'src/services/pricing.ts')!.after).toBeGreaterThan(d.hotspotGrowth.find((h) => h.file === 'src/services/pricing.ts')!.before);
  });

  it('diffing a snapshot with itself is empty', () => {
    const d = diffSnapshots(g.snapshots[1], g.snapshots[1]);
    expect([d.addedModules, d.removedModules, d.changedModules, d.addedEdges, d.removedEdges, d.hotspotGrowth].every((x) => x.length === 0)).toBe(true);
  });

  it('raises churn × complexity hotspot findings', () => {
    const hs = a.findings.filter((f) => f.cat === 'hotspot');
    expect(hs.map((f) => ({ file: f.file, sev: f.sev }))).toEqual(truth.hotspots);
    for (const f of hs) {
      expect(f.conf).toBe('resolved');
      expect(f.line).toBe(1);
    }
    for (const file of truth.notHotspots) expect(hs.some((f) => f.file === file), file).toBe(false);
  });

  it('adds a History section to the report', () => {
    const s = buildSections(a).find((x) => x.id === 'history')!;
    expect(s).toBeTruthy();
    expect(s.markdown).toContain('src/services/pricing.ts');
    expect(s.markdown).toContain('hidden coupling');
    expect(s.markdown).toContain('src/legacy/report.ts');
    expect(fullMarkdown(a)).toContain('## History');
  });
});

describe('git history: limits and failure paths', () => {
  it('truncates long histories to maxGitCommits and says so', async () => {
    const a = await analyze({ maxGitCommits: 5 });
    expect(a.git!.totalCommits).toBe(5);
    expect(a.git!.truncated).toBe(true);
    expect(a.git!.notes.join(' ')).toMatch(/only the most recent 5 commits/);
    expect(a.git!.commits[0].msg).toBe('chore: bump dependencies');
  });

  it('without a .git folder: no history, an explanation, no History report section', async () => {
    const { analysis: a } = await analyzeMem({ 'src/a.ts': 'export const a = 1;\n', 'src/b.ts': "import { a } from './a';\n" });
    expect(a.git).toBeNull();
    expect(a.gitMessage).toMatch(/\.git folder/);
    expect(a.findings.some((f) => f.cat === 'hotspot')).toBe(false);
    expect(buildSections(a).some((s) => s.id === 'history')).toBe(false);
  });

  it('with a corrupt .git folder: history disabled with a reason, the rest of the analysis intact', async () => {
    const enc = new TextEncoder();
    const a = await analyze({}, [
      { path: 'src/a.ts', bytes: enc.encode('export const a = 1;\n') },
      { path: 'src/b.ts', bytes: enc.encode("import { a } from './a';\n") },
      { path: '.git/HEAD', bytes: enc.encode('ref: refs/heads/main\n') },
      { path: '.git/config', bytes: enc.encode('[core]\n') },
      { path: '.git/objects/ab/cdef', bytes: enc.encode('not a zlib object') },
    ]);
    expect(a.git).toBeNull();
    expect(a.gitMessage).toMatch(/could not be read/);
    expect(a.stage).toBe('done');
    expect(a.imports.some((e) => e.to >= 0)).toBe(true);
  });

  it('enableGit: false ignores the .git folder', async () => {
    const a = await analyze({ enableGit: false });
    expect(a.git).toBeNull();
  });
});

describe('co-change filtering', () => {
  it('skips test ↔ test pairs but keeps test ↔ source pairs', async () => {
    const src = (v: number) => `export const x = ${v};\n`;
    const t = (name: string, v: number) => `import { x } from '../src/x';\nexport const ${name} = x + ${v};\n`;
    const files = await buildRepo([1, 2, 3].map((v) => ({ who: ALICE, msg: `change ${v}`, files: { 'src/x.ts': src(v), 'tests/a.test.ts': t('a', v), 'tests/b.test.ts': t('b', v) } })));
    const a = await analyze({}, files);
    const pairs = a.git!.cochange.map((c) => `${c.a} ${c.b} ${c.linked}`);
    expect(pairs.sort()).toEqual(['src/x.ts tests/a.test.ts true', 'src/x.ts tests/b.test.ts true']);
  });
});

// Follow-ups fixed in U2: renames keep history; a test importing its own package is not hidden coupling.
describe('git history: renames and package self-imports (git-moves, planted truth)', () => {
  const moves = groundTruth('git-moves');
  let a: Analysis;
  let g: GitResult;
  beforeAll(async () => {
    a = await analyze({}, await gitMovesFiles());
    g = a.git!;
  }, 120_000);

  it('reads the history', () => {
    expect(g.totalCommits).toBe(moves.totalCommits);
    expect(g.authors.map(({ name, commits, files }) => ({ name, commits, files }))).toEqual(moves.authors);
  });

  it('detects exact and edited renames with the right confidence', () => {
    const msg = new Map(g.commits.map((c) => [c.oid, c.msg]));
    expect(g.renames!.map(({ from, to, current, similarity, conf, oid }) => ({ from, to, current, similarity, conf, commitMessage: msg.get(oid) }))).toEqual(moves.renames);
  });

  it('counts the history of a renamed file under its current name', () => {
    for (const [file, t] of Object.entries<any>(moves.churn)) {
      const c = g.churn.find((x) => x.file === file);
      expect(c, file).toBeTruthy();
      expect({ commits: c!.commits, authors: c!.authors, topAuthor: c!.topAuthor, topAuthorShare: c!.topAuthorShare }, file).toEqual(t);
    }
    for (const old of moves.notInChurn) expect(g.churn.find((c) => c.file === old), old).toBeUndefined();
  });

  it('computes ownership with renamed files merged', () => {
    expect(g.busFactor.overall).toBe(moves.busFactor);
    expect(g.busFactor.risky.map((r) => r.file).sort()).toEqual(moves.busFactorRiskyFiles);
  });

  it('resolves a self-import by package name through package.json exports', () => {
    const { from, spec, to } = moves.selfImport;
    const e = a.imports.find((i) => a.files[i.from].path === from && i.spec === spec)!;
    expect(e).toBeTruthy();
    expect(a.files[e.to]?.path).toBe(to);
  });

  it('links a test to code it reaches through its own package (6 hops); keeps the real hidden pair', () => {
    expect(g.cochange).toEqual(moves.cochange);
  });

  it('lists renames in the History report section', () => {
    const text = fullMarkdown(a);
    expect(text).toContain('### Renamed and moved files');
    expect(text).toContain('| `lib/old-name.js` | `lib/helpers.js` | 100% |');
    expect(text).toMatch(/`lib\/fmt\.js` \| `lib\/format\/index\.js` \| 83% \| [\d-]+ \| _heuristic_/);
  });
});

describe('lineSimilarity', () => {
  it('scores shared lines over average size', () => {
    expect(lineSimilarity('a\nb\nc\nd', 'a\nb\nc\nd')).toBe(1);
    expect(lineSimilarity('a\nb\nc\nd', 'a\nb\nx\ny')).toBe(0.5);
    expect(lineSimilarity('a\nb', 'c\nd')).toBe(0);
    // indentation and blank lines don't matter
    expect(lineSimilarity('  a\n\nb', 'a\nb\n')).toBe(1);
  });
});

describe('long histories', () => {
  it('handles a longer history (120 commits, stricter co-change threshold)', async () => {
    const files = await buildRepo(Array.from({ length: 120 }, (_, v) => ({ who: ALICE, msg: `change ${v}`, files: { 'src/x.ts': `export const x = ${v};\n`, 'src/y.ts': `export const y = ${v};\n` } })));
    const b = await analyze({}, files);
    expect(b.git!.totalCommits).toBe(120);
    expect(b.git!.churn.find((c) => c.file === 'src/x.ts')!.commits).toBe(120);
    expect(b.git!.cochange).toEqual([{ a: 'src/x.ts', b: 'src/y.ts', count: 120, score: 1, linked: false }]);
    expect(b.git!.notes).toEqual([]);
  }, 120_000);
});

describe('classifyMessage', () => {
  const cases: [string, string][] = [
    ['feat(api): add orders endpoint', 'feat'],
    ['fix!: breaking fix', 'fix'],
    ['tests: more coverage', 'test'],
    ['Merge branch "dev"', 'merge'],
    ['Merge pull request #12 from x/y', 'merge'],
    ['Revert "add thing"', 'revert'],
    ['Fix crash on startup', 'fix'],
    ['Hotfix for login', 'fix'],
    ['Rename helpers', 'refactor'],
    ['Update README', 'docs'],
    ['Bump lodash from 4.17.20 to 4.17.21', 'chore'],
    ['Implement CSV import', 'feat'],
    ['Add spec for parser', 'test'],
    ['wip', 'other'],
    ['initial commit', 'other'],
    ['Docs: typo\n\nfix: body lines are ignored', 'docs'],
  ];
  for (const [msg, type] of cases) it(`${JSON.stringify(msg)} → ${type}`, () => expect(classifyMessage(msg)).toBe(type));
});
