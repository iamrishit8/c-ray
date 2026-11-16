import { describe, expect, it } from 'vitest';
import { SearchIndex } from '../../src/core/search';
import { analyzeFixture, fixtureText } from '../helpers';

async function index(name: string) {
  const { analysis, units } = await analyzeFixture(name);
  return { a: analysis, idx: new SearchIndex(analysis, new Map(units.map((u) => [u.path, u.text]))) };
}

describe('search', () => {
  it('finds symbols by exact name, prefix and camelCase part', async () => {
    const { a, idx } = await index('express-mongoose');
    const top = (q: string) => idx.search(q, 'symbol').symbols.map((h) => a.symbols[h.sym].name);
    expect(top('placeOrder')[0]).toBe('placeOrder');
    expect(top('placeO')).toContain('placeOrder');
    expect(top('cancel')).toContain('cancelOrder');
  });

  it('full-text search returns file:line hits', async () => {
    const { idx } = await index('django-app');
    const res = idx.search('insufficient stock', 'text');
    const hit = res.files.find((f) => f.path === 'catalog/services.py');
    expect(hit).toBeTruthy();
    expect(hit!.lines[0].text).toContain('insufficient stock');
    const expected = fixtureText('django-app', 'catalog/services.py').split('\n').findIndex((l) => l.includes('insufficient stock')) + 1;
    expect(hit!.lines[0].line).toBe(expected);
  });

  it('finds files by path and textual occurrences of an identifier', async () => {
    const { idx } = await index('monorepo');
    expect(idx.search('InvoiceList').files.some((f) => f.path.endsWith('InvoiceList.tsx') && f.pathMatch)).toBe(true);
    const occ = idx.occurrences('formatMoney');
    expect(new Set(occ.map((o) => o.file))).toEqual(new Set([
      'packages/shared/src/index.ts', 'packages/shared/src/money.ts', 'packages/api/src/services/invoiceService.ts',
      'packages/web/src/components/InvoiceTotal.tsx', 'packages/web/src/components/InvoiceList.tsx',
    ]));
    expect(idx.search('').symbols).toHaveLength(0);
    expect(idx.search('zzzqqqxxx').files).toHaveLength(0);
  });
});
