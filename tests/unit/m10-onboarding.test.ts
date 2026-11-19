// M10: the onboarding guide (reading path, glossary, how to run it, first-week checklist) against planted truth.
import { describe, expect, it } from 'vitest';
import { splitWords, singular } from '../../src/core/onboarding/glossary';
import { buildSections } from '../../src/core/report';
import { nodeEnv } from '../../src/core/node-env';
import { runPipeline } from '../../src/core/pipeline';
import { buildRepo, gitHistoryFiles } from '../git-fixture';
import { analyzeFixture, analyzeMem, FIXTURE_NAMES, fixtureSource, groundTruth } from '../helpers';

const TABS = ['flows', 'data', 'decisions', 'deps', 'health', 'impact', 'history'];

describe.each(FIXTURE_NAMES)('onboarding: %s', (name) => {
  const truth = groundTruth(name).onboarding;

  it('builds the planted reading path in order; the core step never repeats a file', async () => {
    const { analysis: a } = await analyzeFixture(name);
    const path = a.onboarding!.path;
    expect(path.map((s) => s.id)).toEqual(truth.steps);
    const all = path.flatMap((s) => s.files.map((f) => f.file));
    const core = path.find((s) => s.id === 'core')!;
    const others = new Set(path.filter((s) => s.id !== 'core').flatMap((s) => s.files.map((f) => f.file)));
    expect(core.files.filter((f) => others.has(f.file)), 'core repeats nothing').toEqual([]);
    for (const s of path) expect(new Set(s.files.map((f) => f.file)).size, `${s.id} lists a file once`).toBe(s.files.length);
    for (const f of truth.pathContains) expect(all, f).toContain(f);
    const files = new Set((fixtureSource(name) as { files: { path: string }[] }).files.map((f) => f.path));
    for (const s of path) for (const f of s.files) {
      expect(files.has(f.file), `${s.id}: ${f.file}`).toBe(true);
      expect(f.line).toBeGreaterThanOrEqual(1);
      expect(['resolved', 'heuristic', 'unresolved']).toContain(f.conf);
    }
  });

  it('lists the planted run commands with the right confidence and source', async () => {
    const { analysis: a } = await analyzeFixture(name);
    const { commands } = a.onboarding!.run;
    for (const want of truth.commands) {
      const got = commands.find((c: { command: string; cwd?: string }) => c.command === want.command && (c.cwd ?? undefined) === want.cwd);
      expect(got, `${want.cwd ?? ''} ${want.command}`).toBeTruthy();
      expect(got!.conf).toBe(want.conf);
      if (want.file) expect(got!.file).toBe(want.file);
    }
    for (const c of commands) expect(c.line).toBeGreaterThanOrEqual(1);
  });

  it('finds the environment variables, example values, ports and prerequisites', async () => {
    const { analysis: a } = await analyzeFixture(name);
    const { env, ports, prerequisites } = a.onboarding!.run;
    expect(Object.fromEntries(env.map((e) => [e.name, e.example]))).toEqual(truth.env);
    expect(ports.map((p) => p.port)).toEqual(truth.ports);
    const text = prerequisites.map((p) => p.text).join(' | ');
    for (const p of truth.prerequisites) expect(text, p).toContain(p);
  });

  it('builds a glossary of the domain, without plumbing words', async () => {
    const { analysis: a } = await analyzeFixture(name);
    const terms = a.onboarding!.glossary;
    for (const e of truth.glossary) {
      const t = terms.find((x) => x.term === e);
      expect(t, e).toBeTruthy();
      expect(t!.kind).toBe('entity');
    }
    const words = terms.map((t) => t.term.toLowerCase());
    for (const w of ['service', 'controller', 'util', 'route', 'index', 'app']) expect(words, w).not.toContain(w);
    expect(terms.length).toBeLessThanOrEqual(40);
  });

  it('generates the planted checklist, with real targets', async () => {
    const { analysis: a } = await analyzeFixture(name);
    const items = a.onboarding!.checklist;
    expect(items.map((i) => i.id)).toEqual(expect.arrayContaining(truth.checklist));
    expect(new Set(items.map((i) => i.id)).size).toBe(items.length);
    for (const i of items) {
      expect(['Day 1', 'Days 2–3', 'Days 4–5']).toContain(i.when);
      if (i.tab) expect(TABS).toContain(i.tab);
    }
    const trace = items.find((i) => i.id === 'trace')!;
    expect(a.entries.some((e) => e.id === trace.focus?.entry), 'trace points at a real entry point').toBe(true);
  });
});

describe('onboarding: how to run it never leaks real environment files', () => {
  it('copies example values from templates only', async () => {
    const { analysis: a } = await analyzeMem({
      'package.json': '{"name":"x","scripts":{"start":"node a.js"}}', 'a.js': 'console.log(1);\n',
      '.env': 'API_TOKEN=live-secret-123\nPORT=8080\n', '.env.example': 'API_TOKEN=changeme\n',
    }, 'env');
    const env = a.onboarding!.run.env;
    expect(env.find((e) => e.name === 'API_TOKEN')!.example).toBe('changeme');
    expect(env.find((e) => e.name === 'PORT')).toMatchObject({ file: '.env' });
    expect(env.find((e) => e.name === 'PORT')!.example).toBeUndefined();
    expect(JSON.stringify(a.onboarding)).not.toContain('live-secret-123');
  });
  it('takes README commands verbatim from setup headings only, as resolved', async () => {
    const { analysis: a } = await analyzeMem({
      'README.md': '# X\n\nDo not run `rm -rf /`.\n\n## Getting started\n\n```sh\n$ npm install\nnpm run dev -- --port 4000\necho hello\n```\n\n## License\n\n```\nnpm publish\n```\n',
      'package.json': '{"name":"x"}', 'a.js': 'console.log(1);\n',
    }, 'readme');
    const cmds = a.onboarding!.run.commands.filter((c) => c.file === 'README.md');
    expect(cmds.map((c) => c.command)).toEqual(['npm install', 'npm run dev -- --port 4000']);
    expect(cmds.every((c) => c.conf === 'resolved' && c.line >= 8)).toBe(true);
  });
  it('picks the package manager from the lockfile the ingest step skipped', async () => {
    const { analysis: a } = await analyzeMem({ 'package.json': '{"name":"x","scripts":{"test":"vitest"}}', 'yarn.lock': '# yarn\n', 'a.js': 'console.log(1);\n' }, 'yarn');
    expect(a.onboarding!.run.commands.map((c) => c.command)).toEqual(expect.arrayContaining(['yarn install', 'yarn test']));
  });
  it('says so when there is nothing to run, instead of inventing steps', async () => {
    const { analysis: a } = await analyzeMem({ 'notes.txt': 'hi\n', 'b.md': '# B\n' }, 'nothing');
    expect(a.onboarding!.run.commands).toEqual([]);
    const run = a.onboarding!.checklist.find((i) => i.id === 'run')!;
    expect(run.conf).toBe('unresolved');
    expect(run.text).toBe('Work out how to run it');
  });
});

describe('onboarding: with git history', () => {
  it('adds who-knows-what from the planted single-owner file', async () => {
    const truth = groundTruth('git-history').busFactorRisky[0];
    const a = (await runPipeline({ kind: 'memory', files: await gitHistoryFiles() }, 'git-history', {}, nodeEnv({ l2: false }))).analysis;
    const owners = a.onboarding!.checklist.find((i) => i.id === 'owners')!;
    expect(owners.tab).toBe('history');
    expect(owners.file).toBe(truth.file);
    expect(owners.detail).toContain(truth.author);
    expect(owners.detail).toContain(`${Math.round(truth.share * 100)}%`);
    expect(owners.conf).toBe('resolved');
  });
  it('is absent without a .git folder', async () => {
    const { analysis: a } = await analyzeFixture('express-mongoose');
    expect(a.onboarding!.checklist.find((i) => i.id === 'owners')).toBeUndefined();
  });
});

describe('glossary helpers', () => {
  it('splits camelCase, snake_case, kebab-case and acronyms', () => {
    expect(splitWords('OrderItem')).toEqual(['order', 'item']);
    expect(splitWords('order_items-list')).toEqual(['order', 'items', 'list']);
    expect(splitWords('HTTPServer2')).toEqual(['http', 'server2']);
  });
  it('singularises the common cases and leaves look-alikes alone', () => {
    expect(singular('invoices')).toBe('invoice');
    expect(singular('categories')).toBe('category');
    for (const w of ['status', 'address', 'analysis', 'bus']) expect(singular(w)).toBe(w);
  });
});

describe('onboarding in the export', () => {
  it('is a section with a task-list checklist, resolved/heuristic commands and the no-run disclaimer', async () => {
    const { analysis: a } = await analyzeFixture('express-mongoose');
    const s = buildSections(a, ['onboarding'])[0];
    expect(s.title).toBe('Onboarding guide');
    expect(s.markdown).toContain('- [ ] Get it running locally');
    expect(s.markdown).toContain('`npm start`');
    expect(s.markdown).toContain('Nothing was run.');
    expect(s.markdown).toContain('`mongodb://localhost:27017/shop`');
  });
  it('sections stay in a sensible order', async () => {
    const { analysis: a } = await analyzeFixture('monorepo');
    const ids = buildSections(a).map((s) => s.id);
    expect(ids.indexOf('onboarding')).toBe(1);
    expect(ids.indexOf('decisions')).toBeGreaterThan(ids.indexOf('architecture'));
    expect(ids.indexOf('decisions')).toBeLessThan(ids.indexOf('flows'));
  });
});
