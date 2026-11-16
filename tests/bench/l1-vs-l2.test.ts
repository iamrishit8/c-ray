// Benchmark: precision/recall of L1 (tree-sitter, heuristic) edges measured
// against L2 (TypeScript compiler, exact) on the TS/JS fixtures.
// Run with: npm run bench:l1l2   (writes tests/bench/l1-vs-l2.results.json)
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
import { analyzeFixture } from '../helpers';

const pctf = (n: number) => `${(n * 100).toFixed(1)}%`;

it('L1 vs L2 accuracy on TS/JS fixtures', async () => {
  const rows: Record<string, unknown>[] = [];
  const total = { itp: 0, ifp: 0, ifn: 0, ctp: 0, cfp: 0, cfn: 0 };
  for (const name of ['express-mongoose', 'nestjs-prisma', 'monorepo']) {
    const { analysis: a } = await analyzeFixture(name);
    const acc = a.l1Accuracy!;
    expect(acc, name).toBeTruthy();
    rows.push({
      fixture: name, files: a.coverage.l2Files,
      importPrecision: pctf(acc.imports.precision), importRecall: pctf(acc.imports.recall),
      callPrecision: pctf(acc.calls.precision), callRecall: pctf(acc.calls.recall),
      importEdges: acc.imports.tp + acc.imports.fn, callEdges: acc.calls.tp + acc.calls.fn,
    });
    total.itp += acc.imports.tp; total.ifp += acc.imports.fp; total.ifn += acc.imports.fn;
    total.ctp += acc.calls.tp; total.cfp += acc.calls.fp; total.cfn += acc.calls.fn;
    // import resolution shares the resolver, so L1 must be essentially exact there
    expect(acc.imports.recall, `${name} import recall`).toBeGreaterThanOrEqual(0.95);
    expect(acc.imports.precision, `${name} import precision`).toBeGreaterThanOrEqual(0.95);
    // call edges are heuristic: require them to be useful, not perfect
    expect(acc.calls.precision, `${name} call precision`).toBeGreaterThanOrEqual(0.8);
    expect(acc.calls.recall, `${name} call recall`).toBeGreaterThanOrEqual(0.5);
  }
  const overall = {
    fixture: 'ALL',
    importPrecision: pctf(total.itp / (total.itp + total.ifp)), importRecall: pctf(total.itp / (total.itp + total.ifn)),
    callPrecision: pctf(total.ctp / (total.ctp + total.cfp)), callRecall: pctf(total.ctp / (total.ctp + total.cfn)),
    importEdges: total.itp + total.ifn, callEdges: total.ctp + total.cfn,
  };
  rows.push(overall);
  writeFileSync(join(fileURLToPath(new URL('.', import.meta.url)), 'l1-vs-l2.results.json'), JSON.stringify(rows, null, 2) + '\n');
});
