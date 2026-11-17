import { describe, expect, it } from 'vitest';
import type { Analysis, FileUnit } from '../../src/core/types';
import { analyzeFixture, analyzeMem, FIXTURE_NAMES, groundTruth } from '../helpers';

function lineText(units: FileUnit[], file: string, line: number): string {
  return units.find((u) => u.path === file)?.text.split('\n')[line - 1] ?? '';
}
function refExists(a: Analysis, file: string, line: number): boolean {
  const f = a.files.find((x) => x.path === file);
  return !!f && line >= 1 && line <= Math.max(1, f.loc + 1);
}

describe('dependency intelligence + health on fixtures', () => {
  for (const name of FIXTURE_NAMES) {
    it(`${name}: planted cycle, layering violation, secret, duplicate, TODOs`, async () => {
      const gt = groundTruth(name);
      const { analysis: a, units } = await analyzeFixture(name);

      // circular dependency, with its edges
      const cyc = a.deps.cycles.find((c) => gt.cycle.every((f: string) => c.files.includes(f)) && c.files.length === gt.cycle.length);
      expect(cyc, `cycle ${gt.cycle.join(' <-> ')} in ${JSON.stringify(a.deps.cycles.map((c) => c.files))}`).toBeTruthy();
      expect(cyc!.edges.length).toBe(gt.cycle.length);
      for (const e of cyc!.edges) expect(refExists(a, e.from, e.line)).toBe(true);

      // layering violation
      const v = a.deps.violations.find((x) => x.file === gt.layeringViolation.file && lineText(units, x.file, x.line).includes(gt.layeringViolation.contains));
      expect(v, `violation in ${gt.layeringViolation.file}: ${JSON.stringify(a.deps.violations.map((x) => `${x.file}:${x.line}`))}`).toBeTruthy();
      expect(v!.conf).toBe('heuristic');

      // hardcoded secret
      const secret = a.findings.find((f) => f.cat === 'secret' && f.file === gt.secret.file && lineText(units, f.file, f.line).includes(gt.secret.contains));
      expect(secret, `secret in ${gt.secret.file}`).toBeTruthy();

      // duplicated block
      const [d1, d2] = gt.duplicate;
      const clone = a.findings.find((f) => f.cat === 'clone' && ((f.file === d1 && f.related?.[0].file === d2) || (f.file === d2 && f.related?.[0].file === d1)));
      expect(clone, `clone between ${d1} and ${d2}: ${JSON.stringify(a.findings.filter((f) => f.cat === 'clone').map((f) => [f.file, f.related?.[0].file]))}`).toBeTruthy();
      expect(clone!.endLine! - clone!.line).toBeGreaterThanOrEqual(5);

      for (const t of gt.todos ?? []) expect(a.findings.some((f) => f.cat === 'todo' && f.file === t.file && f.msg.startsWith(t.tag)), `${t.tag} in ${t.file}`).toBe(true);
      if (gt.sqlConcat) expect(a.findings.some((f) => f.cat === 'sql-concat' && f.file === gt.sqlConcat.file && lineText(units, f.file, f.line).includes(gt.sqlConcat.contains))).toBe(true);
      if (gt.tlsDisabled) expect(a.findings.some((f) => f.cat === 'tls-disabled' && f.file === gt.tlsDisabled.file && lineText(units, f.file, f.line).includes(gt.tlsDisabled.contains))).toBe(true);
      for (const d of gt.deadExports ?? []) expect(a.findings.some((f) => f.cat === 'dead-export' && f.file === d.file && f.msg.includes(d.name)), `dead export ${d.name}`).toBe(true);

      // every finding and violation points at a real location
      for (const f of a.findings) {
        expect(refExists(a, f.file, f.line), `${f.cat} ${f.file}:${f.line}`).toBe(true);
        for (const r of f.related ?? []) expect(refExists(a, r.file, r.line)).toBe(true);
      }
      for (const x of a.deps.violations) expect(refExists(a, x.file, x.line)).toBe(true);
    });
  }

  it('dead exports are exact: used, re-exported-and-used and public API exports are not flagged', async () => {
    const { analysis: a } = await analyzeFixture('monorepo');
    const dead = a.findings.filter((f) => f.cat === 'dead-export').map((f) => f.msg);
    for (const used of ['formatMoney', 'addMoney', 'validateInvoice', 'InvoiceDto', 'invoiceRoutes', 'dataSource', 'App']) {
      expect(dead.some((m) => m.includes(`"${used}"`)), used).toBe(false);
    }
    expect(a.findings.find((f) => f.cat === 'dead-export')!.conf).toBe('resolved');
  });

  it('coupling metrics, external package usage and undeclared packages', async () => {
    const { analysis: a } = await analyzeFixture('express-mongoose');
    const metric = (f: string) => a.deps.metrics.find((m) => m.file === f)!;
    expect(metric('src/config.js').fanIn).toBe(3);
    expect(metric('src/config.js').fanOut).toBe(0);
    expect(metric('src/config.js').instability).toBe(0);
    expect(metric('src/server.js').instability).toBe(1);
    expect(metric('src/services/orderService.js').fanOut).toBe(3);
    const pkg = (n: string) => a.deps.packages.find((p) => p.name === n)!;
    expect(pkg('mongoose').declared).toBe(true);
    expect(pkg('mongoose').version).toBe('^8.3.0');
    expect(pkg('mongoose').uses.map((u) => u.file).sort()).toEqual(['src/models/Order.js', 'src/models/User.js', 'src/server.js']);
    expect(pkg('jest').uses).toHaveLength(0); // declared, never imported
    const { analysis: b } = await analyzeMem({
      'package.json': '{"dependencies":{"left-pad":"1.0.0"}}',
      'a.js': "const _ = require('lodash');\nconst fs = require('fs');\nmodule.exports = _.noop;\n",
      'b.js': "require('./a');\n",
    });
    expect(b.deps.packages.find((p) => p.name === 'lodash')!.declared).toBe(false);
    expect(b.deps.packages.find((p) => p.name === 'node:fs')!.declared).toBe(true);
  });

  it('flags oversized functions, high complexity, deep nesting and god modules on synthetic input', async () => {
    const big = 'export function huge(a) {\n' + Array.from({ length: 40 }, (_, i) => `  if (a === ${i}) { for (const x of a) { while (x) { if (x > ${i}) { try { a++; } catch (e) { a--; } } } } }`).join('\n') + '\n' + '  a += 1;\n'.repeat(140) + '}\n';
    const files: Record<string, string> = { 'src/huge.js': big, 'README.md': '# x\n' };
    const imports = Array.from({ length: 24 }, (_, i) => `import { f${i} } from './m${i}';`).join('\n');
    files['src/hub.js'] = imports + '\n' + Array.from({ length: 60 }, (_, i) => `export function h${i}() { return ${i}; }`).join('\n') + '\n';
    for (let i = 0; i < 24; i++) files[`src/m${i}.js`] = `export function f${i}() { return ${i}; }\n`;
    const { analysis: a } = await analyzeMem(files);
    const cats = (file: string) => a.findings.filter((f) => f.file === file).map((f) => f.cat);
    expect(cats('src/huge.js')).toEqual(expect.arrayContaining(['oversize-function', 'complexity', 'nesting']));
    expect(a.deps.godModules.map((g) => g.file)).toContain('src/hub.js');
    expect(a.deps.cycles).toHaveLength(0);
  });

  it('longer cycles are listed with every edge', async () => {
    const { analysis: a } = await analyzeMem({
      'a.ts': "import { b } from './b';\nexport const a = () => b();\n",
      'b.ts': "import { c } from './c';\nexport const b = () => c();\n",
      'c.ts': "import { a } from './a';\nimport { d } from './d';\nexport const c = () => a() + d();\n",
      'd.ts': "import type { T } from './c';\nexport const d = () => 1;\nexport type U = T;\n",
    });
    expect(a.deps.cycles).toHaveLength(1); // the type-only edge d -> c does not make a runtime cycle
    expect(a.deps.cycles[0].files.sort()).toEqual(['a.ts', 'b.ts', 'c.ts']);
    expect(a.deps.cycles[0].edges.map((e) => `${e.from}>${e.to}`).sort()).toEqual(['a.ts>b.ts', 'b.ts>c.ts', 'c.ts>a.ts']);
  });
});
