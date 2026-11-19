// M10: the decision catalogue against planted truth in each fixture's ground-truth.json
// (hand-written from the fixture files), plus ADR/prose parsing and the honesty invariants.
import { describe, expect, it } from 'vitest';
import { findRationale, parseAdr } from '../../src/core/decisions/docs';
import { looksLikeAuth, minConf } from '../../src/core/decisions/catalogue';
import { buildSections, fullMarkdown } from '../../src/core/report';
import { ANALYSIS_VERSION, CATEGORY_ORDER, type Analysis, type Decision } from '../../src/core/types';
import { analyzeFixture, analyzeMem, FIXTURE_NAMES, fixtureSource, groundTruth } from '../helpers';

const byId = (a: Analysis, id: string): Decision => a.decisions.find((d) => d.id === id)!;
const observedText = (d: Decision) => d.observed.map((o) => o.text).join(' | ');

describe.each(FIXTURE_NAMES)('decisions: %s', (name) => {
  const truth = groundTruth(name).decisions;

  it('finds exactly the planted decisions', async () => {
    const { analysis: a } = await analyzeFixture(name);
    expect(a.decisions.map((d) => d.id).sort()).toEqual([...truth.ids].sort());
    expect(a.notices.filter((n) => /decision/i.test(n))).toEqual([]);
  });

  it('matches each decision’s confidence, wording, evidence and observations', async () => {
    const { analysis: a } = await analyzeFixture(name);
    for (const c of truth.checks) {
      const d = byId(a, c.id);
      expect(d, c.id).toBeTruthy();
      expect(d.conf, `${c.id} confidence`).toBe(c.conf);
      for (const t of c.text) expect(d.decision, `${c.id} text`).toContain(t);
      for (const f of c.evidenceFiles ?? []) expect(d.evidence.map((e) => e.file), `${c.id} evidence`).toContain(f);
      for (const o of c.observed ?? []) expect(observedText(d), `${c.id} observed`).toContain(o);
      for (const at of c.observedAt ?? []) expect(d.observed.some((o) => o.file === at.file && (at.line === undefined || o.line === at.line)), `${c.id} observed at ${at.file}:${at.line}`).toBe(true);
      if (c.why) {
        expect(d.why?.conf).toBe(c.why.conf);
        expect(d.why?.file).toBe(c.why.file);
        expect(d.why?.line).toBe(c.why.line);
        expect(d.why?.text).toContain(c.why.contains);
      }
    }
  });

  it('is honest: every file reference exists, lines are real, only the project’s own words are "resolved" reasons', async () => {
    const { analysis: a } = await analyzeFixture(name);
    const files = new Set((fixtureSource(name) as { files: { path: string }[] }).files.map((f) => f.path));
    const ids = new Set<string>();
    for (const d of a.decisions) {
      expect(ids.has(d.id), `duplicate id ${d.id}`).toBe(false);
      ids.add(d.id);
      expect(['resolved', 'heuristic', 'unresolved']).toContain(d.conf);
      for (const e of d.evidence) {
        if (e.file) {
          expect(files.has(e.file), `${d.id} evidence file ${e.file}`).toBe(true);
          expect(e.line, `${d.id} evidence line`).toBeGreaterThanOrEqual(1);
        }
      }
      for (const c of [...d.observed, ...(d.why ? [d.why] : [])]) {
        if (c.file) {
          expect(files.has(c.file), `${d.id} claim file ${c.file}`).toBe(true);
          expect(c.line, `${d.id} claim line`).toBeGreaterThanOrEqual(1);
        }
      }
      // a "resolved" reason must point at a file: it is a quote, never an inference
      if (d.why?.conf === 'resolved') expect(d.why.file).toBeTruthy();
      if (d.conf === 'unresolved') expect(d.why?.conf).not.toBe('resolved');
    }
    const order = a.decisions.map((d) => CATEGORY_ORDER.indexOf(d.category));
    expect(order).toEqual([...order].sort((x, y) => x - y));
  });
});

describe('decisions: the team’s decision record (monorepo ADR)', () => {
  const truth = groundTruth('monorepo').decisions.adr;
  it('is read as a resolved, documented decision with its own words', async () => {
    const { analysis: a } = await analyzeFixture('monorepo');
    const d = byId(a, truth.id);
    expect(d.category).toBe('Documented');
    expect(d.source).toBe('adr');
    expect(d.conf).toBe('resolved');
    expect(d.title).toBe(truth.title);
    expect(d.adr).toEqual({ status: truth.status, date: truth.date, number: truth.number });
    expect(d.decision).toContain(truth.decision);
    expect(d.why).toMatchObject({ conf: 'resolved', file: truth.why.file, line: truth.why.line });
    expect(d.why!.text).toContain(truth.why.contains);
    expect(d.tradeoffs.join(' ')).toContain(truth.consequence);
    expect(d.observed.some((o) => /not checked that the code still follows/.test(o.text) && o.conf === 'unresolved')).toBe(true);
  });
  it('comes first in the list', async () => {
    const { analysis: a } = await analyzeFixture('monorepo');
    expect(a.decisions[0].id).toBe(truth.id);
  });
});

describe('parseAdr', () => {
  it('reads the Nygard layout', () => {
    const p = parseAdr('docs/adr/0007-use-postgres.md', '# 7. Use Postgres\n\nDate: 2024-01-05\n\n## Status\n\nAccepted\n\n## Context\n\nWe need transactions.\n\n## Decision\n\nWe will use PostgreSQL.\n\n## Consequences\n\n- Need migrations.\n- Ops cost.\n');
    expect(p).toMatchObject({ title: 'Use Postgres', number: 7, status: 'Accepted', date: '2024-01-05' });
    expect(p.context).toEqual({ text: 'We need transactions.', line: 9 });
    expect(p.decision).toEqual({ text: 'We will use PostgreSQL.', line: 13 });
    expect(p.consequences).toEqual(['Need migrations.', 'Ops cost.']);
  });
  it('reads the MADR layout; "Decision Drivers" is context, not the decision', () => {
    const p = parseAdr('adr/adr-0002-queue.md', '---\nstatus: superseded by ADR-0009\ndate: 2023-06-30\n---\n# ADR-0002: Use RabbitMQ\n\n## Context and Problem Statement\n\nJobs block requests.\n\n## Decision Drivers\n\n* latency\n\n## Decision Outcome\n\nChosen option: "RabbitMQ", because it routes flexibly.\n\n## Consequences\n\nAnother broker to run. Retries need care.\n');
    expect(p.number).toBe(2);
    expect(p.title).toBe('Use RabbitMQ');
    expect(p.decision!.text).toContain('Chosen option: "RabbitMQ"');
    expect(p.context!.text).toContain('Jobs block requests.');
    expect(p.status).toMatch(/superseded/i);
    expect(p.consequences).toEqual(['Another broker to run.', 'Retries need care.']);
  });
  it('falls back to the first paragraph and survives an empty or title-only file', () => {
    expect(parseAdr('docs/decisions/use-x.md', '# Use X\n\nWe use X for everything.\n').decision!.text).toBe('We use X for everything.');
    expect(() => parseAdr('adr/0001.md', '')).not.toThrow();
    expect(parseAdr('adr/0001.md', '# Only a title\n').decision).toBeUndefined();
  });
  it('marks a superseded record as possibly outdated', async () => {
    const { analysis: a } = await analyzeMem({ 'package.json': '{"name":"x"}', 'docs/adr/0001-old.md': '# 1. Old way\n\n## Status\n\nSuperseded by 2\n\n## Decision\n\nWe use the old way.\n', 'src/a.js': 'module.exports = 1;\n' }, 'superseded');
    const d = a.decisions.find((x) => x.id.startsWith('adr:'))!;
    expect(d.observed.some((o) => /may no longer apply/.test(o.text) && o.conf === 'resolved')).toBe(true);
  });
});

describe('findRationale', () => {
  const unit = (text: string, path = 'README.md') => ({ path, text, lang: 'markdown', hash: 'h', size: text.length });
  it('quotes a sentence that mentions the technology and gives a reason, with its line', () => {
    const r = findRationale([unit('# T\n\nWe use Postgres. It is fine.\nWe chose Redis because it is fast. Also other things.\n')], ['README.md'], ['Redis']);
    expect(r).toEqual({ text: 'We chose Redis because it is fast.', conf: 'resolved', file: 'README.md', line: 4 });
  });
  it('does not invent a reason: no cue word, no match; word boundaries respected', () => {
    expect(findRationale([unit('The app uses Redis for caching.\n')], ['README.md'], ['Redis'])).toBeUndefined();
    expect(findRationale([unit('We chose Express because it is thin.\n')], ['README.md'], ['press'])).toBeUndefined();
    expect(findRationale([unit('```\nwe chose Redis because x\n```\n')], ['README.md'], ['Redis'])).toBeDefined(); // fenced text is still the author's words
  });
});

describe('looksLikeAuth / minConf', () => {
  it('splits camelCase and ignores look-alikes', () => {
    for (const n of ['auth', 'AuthGuard', 'requireAdmin', 'isAuthenticated', 'jwt_check', 'verify-token', 'authorize']) expect(looksLikeAuth(n), n).toBe(true);
    for (const n of ['logger', 'cors', 'bodyParser', 'authorController', 'compression']) expect(looksLikeAuth(n), n).toBe(false);
  });
  it('is the weakest of its parts', () => {
    expect(minConf([])).toBe('resolved');
    expect(minConf(['resolved', 'heuristic'])).toBe('heuristic');
    expect(minConf(['heuristic', 'unresolved', 'resolved'])).toBe('unresolved');
  });
});

describe('decisions: edge cases', () => {
  it('a project with no signal yields no decisions and no failure', async () => {
    const { analysis: a } = await analyzeMem({ 'notes.txt': 'hello\n', 'a.md': '# A\n' }, 'empty');
    expect(a.decisions).toEqual([]);
    expect(a.version).toBe(ANALYSIS_VERSION);
    expect(buildSections(a).find((s) => s.id === 'decisions')).toBeUndefined();
  });
  it('says "unresolved" (never "none") when an HTTP API shows no auth', async () => {
    const { analysis: a } = await analyzeMem({
      'package.json': '{"name":"open","dependencies":{"express":"^4"}}',
      'app.js': "const express = require('express');\nconst app = express();\napp.get('/a', (req, res) => res.send('a'));\napp.post('/b', (req, res) => res.send('b'));\napp.listen(3000);\n",
    }, 'open-api');
    const d = byId(a, 'auth');
    expect(d.conf).toBe('unresolved');
    expect(d.decision).toBe('No authentication mechanism was recognised.');
    expect(d.observed[0].text).toMatch(/Either the API is open/);
  });
  it('makes no auth claim for a project without an HTTP surface', async () => {
    const { analysis: a } = await analyzeMem({ 'package.json': '{"name":"cli","bin":"cli.js"}', 'cli.js': '#!/usr/bin/env node\nconsole.log(1);\n' }, 'cli');
    expect(a.decisions.find((d) => d.id === 'auth')).toBeUndefined();
  });
  it('File Mode (one file) completes without decisions failing', async () => {
    const { analysis: a } = await analyzeMem({ 'solo.py': 'def f():\n    return 1\n' }, 'solo');
    expect(a.mode).toBe('file');
    expect(a.notices.filter((n) => /decision/i.test(n))).toEqual([]);
  });
});

describe('decisions in the export', () => {
  it('appear as a section with confidence, evidence links, and the general-knowledge caveat', async () => {
    const { analysis: a } = await analyzeFixture('express-mongoose');
    const s = buildSections(a, ['decisions'])[0];
    expect(s.title).toBe('Decisions');
    expect(s.markdown).toContain('### Application framework');
    expect(s.markdown).toContain('_resolved_');
    expect(s.markdown).toContain('`README.md:7`');
    expect(s.markdown).toContain('We chose Express because the team already knew it');
    expect(s.markdown).toContain('Typical trade-offs (general knowledge, not measured here)');
    expect(fullMarkdown(a)).toContain('[Decisions](#decisions)');
  });
  it('escapes text that comes from the analysed repo', async () => {
    const { analysis: a } = await analyzeMem({
      'package.json': '{"name":"x"}', 'src/a.js': 'module.exports = 1;\n', 'src/b.js': 'module.exports = 2;\n', 'src/c.js': 'module.exports = 3;\n',
      'docs/adr/0001-x.md': '# 1. <script>alert(1)</script> [x](javascript:alert(1))\n\n## Decision\n\n<img src=x onerror=alert(1)> We will do it.\n',
    }, 'xss');
    const md = buildSections(a, ['decisions'])[0].markdown;
    expect(md).not.toMatch(/<script|<img/);
    expect(md).toContain('&lt;script&gt;');
  });
});
