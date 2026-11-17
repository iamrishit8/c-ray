import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { analyzeImpact } from '../../src/core/impact';
import { modelOf } from '../../src/core/model';
import { analyzeFixture, FIXTURES, groundTruth } from '../helpers';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const TMP = join(HERE, '..', '.tmp');
const TSC = join(HERE, '..', '..', 'node_modules', 'typescript', 'bin', 'tsc');

/** Apply a source mutation to a copy of the monorepo fixture and return the files tsc reports errors in. */
function breakages(id: string, file: string, from: string, to: string): Set<string> {
  const dir = join(TMP, `impact-${id}`);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(TMP, { recursive: true });
  cpSync(join(FIXTURES, 'monorepo'), dir, { recursive: true });
  const p = join(dir, file);
  const src = readFileSync(p, 'utf8');
  expect(src.includes(from), `mutation anchor in ${file}`).toBe(true);
  writeFileSync(p, src.replace(from, to));
  let out = '';
  try {
    execFileSync(process.execPath, [TSC, '-p', dir, '--pretty', 'false'], { encoding: 'utf8' });
  } catch (e) {
    out = String((e as { stdout?: string }).stdout ?? '');
  }
  const files = new Set<string>();
  for (const m of out.matchAll(/^(.+?)\(\d+,\d+\): error TS/gm)) files.add(m[1].replace(/\\/g, '/').replace(/^.*impact-[\w-]+\//, ''));
  rmSync(dir, { recursive: true, force: true });
  return files;
}

describe('impact analysis', () => {
  it('symbol impact: dependents, affected routes, risk factors (ground truth)', async () => {
    const gt = groundTruth('monorepo').impact;
    const { analysis: a } = await analyzeFixture('monorepo');
    const sym = modelOf(a).findSymbol(gt.file, gt.symbol);
    const imp = analyzeImpact(a, { symbol: sym })!;
    const direct = imp.files.filter((f) => f.distance === 1).map((f) => f.file).sort();
    expect(direct).toEqual([...gt.dependents].sort());
    expect(imp.files.every((f) => f.conf === 'resolved')).toBe(true);
    expect(imp.entries.map((e) => e.label)).toContain('POST /api/invoices');
    expect(imp.entries.map((e) => e.label)).not.toContain('GET /api/customers');
    expect(imp.risk.score).toBeGreaterThan(0);
    expect(imp.risk.factors.some((f) => f.label.includes('no test file'))).toBe(true);
    for (const f of imp.files.filter((x) => x.distance === 1)) expect(f.sites.length).toBeGreaterThan(0);
  });

  it('file impact: transitive dependents by distance, heuristic flag for non-TS code', async () => {
    const { analysis: a } = await analyzeFixture('express-mongoose');
    const imp = analyzeImpact(a, { file: 'src/models/User.js' })!;
    const dist = Object.fromEntries(imp.files.map((f) => [f.file, f.distance]));
    expect(dist['src/services/userService.js']).toBe(1);
    expect(dist['src/controllers/userController.js']).toBe(2);
    expect(dist['src/routes/users.js']).toBe(3);
    expect(dist['src/server.js']).toBe(5);
    expect(imp.entries.some((e) => e.label === 'GET /api/users/:id')).toBe(true);
    expect(imp.heuristic).toBe(false);
    const { analysis: d } = await analyzeFixture('django-app');
    const di = analyzeImpact(d, { file: 'catalog/models.py' })!;
    expect(di.heuristic).toBe(true);
    expect(di.files.map((f) => f.file)).toContain('orders/services.py');
    expect(analyzeImpact(a, { file: 'nope.js' })).toBeNull();
  });

  it('recall against real compiler breakages after signature mutations (tsc)', async () => {
    const { analysis: a } = await analyzeFixture('monorepo');
    const m = modelOf(a);
    const cases = [
      { id: 'formatMoney', file: 'packages/shared/src/money.ts', symbol: 'formatMoney', from: 'export function formatMoney(amount: Money): string {', to: 'export function formatMoney(amount: Money, locale: string): string {' },
      { id: 'getCustomer', file: 'packages/api/src/services/customerService.ts', symbol: 'getCustomer', from: 'export async function getCustomer(id: number): Promise<Customer | null> {', to: 'export async function getCustomer(id: number, tenant: string): Promise<Customer | null> {' },
      { id: 'Money', file: 'packages/shared/src/types.ts', symbol: 'Money', from: '  cents: number;\n  currency: string;', to: '  cents: number;\n  currency: string;\n  scale: number;' },
      { id: 'fetchInvoices', file: 'packages/web/src/api/client.ts', symbol: 'fetchInvoices', from: 'export async function fetchInvoices(): Promise<InvoiceDto[]> {', to: 'export async function fetchInvoices(page: number): Promise<InvoiceDto[]> {' },
    ];
    const rows: Record<string, unknown>[] = [];
    let tp = 0;
    let fn = 0;
    let fp = 0;
    let dtp = 0;
    let dfp = 0;
    for (const c of cases) {
      const real = breakages(c.id, c.file, c.from, c.to);
      real.delete(c.file); // the mutated file itself is the cause, not an impact
      expect(real.size, `${c.id} should break something`).toBeGreaterThan(0);
      const imp = analyzeImpact(a, { symbol: m.findSymbol(c.file, c.symbol) })!;
      const predicted = new Set(imp.files.map((f) => f.file));
      const hit = [...real].filter((f) => predicted.has(f));
      const missed = [...real].filter((f) => !predicted.has(f));
      tp += hit.length;
      fn += missed.length;
      fp += [...predicted].filter((f) => !real.has(f)).length;
      const direct = new Set(imp.files.filter((f) => f.distance === 1).map((f) => f.file));
      const dHit = [...real].filter((f) => direct.has(f)).length;
      dtp += dHit;
      dfp += direct.size - dHit;
      rows.push({ mutation: c.id, realBreakages: real.size, predictedTransitive: predicted.size, predictedDirect: direct.size, recall: hit.length / real.size, directRecall: dHit / real.size, missed });
      expect(missed, `${c.id}: breakages not predicted`).toEqual([]);
    }
    const summary = { recall: tp / (tp + fn), precision: tp / (tp + fp), directRecall: dtp / (tp + fn), directPrecision: dtp / (dtp + dfp), cases: rows };
    mkdirSync(join(HERE, '..', 'bench'), { recursive: true });
    writeFileSync(join(HERE, '..', 'bench', 'impact.results.json'), JSON.stringify(summary, null, 2) + '\n');
    expect(summary.recall).toBe(1);
  }, 180_000);
});
