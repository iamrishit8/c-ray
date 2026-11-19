// U4: drift guards for the Home help manual. The manual is data (src/ui/help/content.ts); these tests fail when the
// app and the manual stop agreeing: a page with no entry, an entry for a page that is gone, a documented control that
// no longer exists, a threshold quoted wrongly, or a second wording of the confidence levels.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { CONFIDENCE_HELP, PAGES, QUICK_START, ROUTES, SECTIONS, SHORTCUTS, TERMS, LIMITS } from '../../src/ui/help/content';

const HERE = dirname(fileURLToPath(import.meta.url));
const UI = join(HERE, '../../src/ui');
const read = (p: string) => readFileSync(p, 'utf8');
function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : p.endsWith('.tsx') || p.endsWith('.ts') ? [p] : [];
  });
}
const uiSource = walk(UI).filter((p) => !p.includes('/help/')).map(read).join('\n');

/** Every test id the UI code can produce: literal ids, and the literal prefix of `prefix-${x}` ids. */
function testIds() {
  const exact = new Set<string>();
  const prefixes = new Set<string>();
  for (const m of uiSource.matchAll(/(?:data-testid|testId|testid)=\{?[`"']([^`"']+)[`"']/g)) {
    const v = m[1];
    const cut = v.indexOf('${');
    if (cut >= 0) prefixes.add(v.slice(0, cut));
    else exact.add(v);
  }
  return (id: string) => exact.has(id) || [...prefixes].some((p) => p && id.startsWith(p));
}
const hasTestId = testIds();

const tabIds = [...read(join(UI, 'ProjectView.tsx')).matchAll(/\{ id: '([a-z]+)', label:/g)].map((m) => m[1]);

describe('help manual: it covers the app', () => {
  it('finds the tabs it is checked against', () => {
    expect(tabIds.length).toBeGreaterThanOrEqual(13);
  });

  it('has exactly one entry per page, plus File Mode, and no entry for a page that is gone', () => {
    const ids = PAGES.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const t of tabIds) expect(ids, `page "${t}" has no manual entry`).toContain(t);
    for (const id of ids) if (id !== 'file-mode') expect(tabIds, `manual entry "${id}" names a page that no longer exists`).toContain(id);
    expect(ids).toContain('file-mode');
  });

  it('only documents controls that still exist in the UI code', () => {
    for (const p of PAGES) {
      expect(p.controls.length, `${p.id} documents no controls`).toBeGreaterThan(0);
      for (const c of p.controls) expect(hasTestId(c), `${p.id}: control "${c}" is not in the UI`).toBe(true);
    }
  });

  it('routes by goal only name real pages', () => {
    for (const r of ROUTES) for (const s of r.steps) expect(tabIds, `route "${r.goal}" names ${s.tab}`).toContain(s.tab);
  });

  it('has a section for every in-page navigation entry, with unique ids', () => {
    expect(SECTIONS.map((s) => s.id)).toEqual(['quick-start', 'routes', 'pages', 'terms', 'shortcuts', 'limits']);
  });
});

describe('help manual: worked examples are replayable', () => {
  it('every example starts somewhere, does things by known test ids and checks something', () => {
    for (const p of PAGES) {
      const e = p.example;
      expect(e.steps.length, p.id).toBeGreaterThan(0);
      expect(e.checks.length, `${p.id} has no checks`).toBeGreaterThan(0);
      expect(e.sees.length, p.id).toBeGreaterThan(20);
      for (const s of e.steps) {
        for (const a of s.do ?? []) {
          if ('tab' in a) expect(tabIds, `${p.id}: unknown tab ${a.tab}`).toContain(a.tab);
          if ('click' in a) expect(hasTestId(a.click), `${p.id}: click ${a.click}`).toBe(true);
          if ('clickText' in a) expect(hasTestId(a.within), `${p.id}: within ${a.within}`).toBe(true);
          if ('fill' in a) expect(hasTestId(a.fill), `${p.id}: fill ${a.fill}`).toBe(true);
        }
      }
      for (const c of e.checks) expect(hasTestId(c.testid), `${p.id}: check ${c.testid}`).toBe(true);
    }
  });

  it('every page except File Mode uses the bundled sample project', () => {
    for (const p of PAGES) expect(p.example.start === 'sample', p.id).toBe(p.id !== 'file-mode');
  });
});

describe('help manual: terminology', () => {
  const REQUIRED = [
    'confidence', 'resolved', 'heuristic', 'unresolved', 'l0', 'l1', 'l2', 'file-mode', 'coverage', 'notice', 'entry-point', 'route', 'handler',
    'middleware', 'role', 'symbol', 'import', 'fan-in', 'fan-out', 'instability', 'circular', 'god-module', 'layering', 'dead-export', 'clone',
    'hotspot', 'churn', 'co-change', 'hidden-coupling', 'bus-factor', 'snapshot', 'blast-radius', 'dsm', 'er', 'adr', 'decision-category',
    'glossary-term', 'reading-path',
  ];
  it('defines every term the app uses, once', () => {
    const ids = TERMS.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(TERMS.map((t) => t.term.toLowerCase())).size).toBe(TERMS.length);
    for (const r of REQUIRED) expect(ids, `missing term ${r}`).toContain(r);
    for (const t of TERMS) {
      expect(t.def.length, t.id).toBeGreaterThan(20);
      expect(t.where.length, t.id).toBeGreaterThan(3);
      expect(t.why.length, t.id).toBeGreaterThan(10);
    }
  });

  it('uses one wording for the confidence levels, shared with the tooltips in the app', () => {
    for (const c of ['resolved', 'heuristic', 'unresolved'] as const) {
      expect(TERMS.find((t) => t.id === c)!.def).toBe(CONFIDENCE_HELP[c]);
    }
    const kit = read(join(UI, 'kit.tsx'));
    expect(kit).toContain('CONFIDENCE_HELP[c]');
    expect(kit).not.toMatch(/Resolved: derived exactly/);
  });

  it('quotes the same thresholds the code uses', () => {
    const deps = read(join(HERE, '../../src/core/deps.ts'));
    for (const frag of ['f.loc > 1000', 'f.symbols > 50', 'mt.fanOut > 20', 'mt.fanIn > 30']) expect(deps).toContain(frag);
    const god = TERMS.find((t) => t.id === 'god-module')!.def;
    for (const n of ['1,000', '50', '20', '30']) expect(god).toContain(n);
    const symbols = read(join(UI, 'SymbolsView.tsx'));
    expect(symbols).toContain('s.complexity >= 15');
    expect(symbols).toContain('s.complexity >= 8');
    expect(TERMS.find((t) => t.id === 'complexity')!.why).toMatch(/8 or more.*15 or more/);
  });
});

describe('help manual: copy rules', () => {
  const all = JSON.stringify({ PAGES, TERMS, QUICK_START, ROUTES, SHORTCUTS, LIMITS });
  it('stays in plain text: no HTML, no placeholder text, no em dashes', () => {
    expect(all).not.toMatch(/<[a-z]+[ >]/i);
    expect(all).not.toMatch(/\bTBD\b|lorem ipsum/i);
    expect(all).not.toContain('—');
  });
  it('does not promise network behaviour the privacy rules forbid', () => {
    expect(all).not.toMatch(/uploaded to|sent to our|we collect/i);
  });
});
