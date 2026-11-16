import { describe, expect, it } from 'vitest';
import { modelOf } from '../../src/core/model';
import type { Analysis } from '../../src/core/types';
import { analyzeFixture, analyzeMem, groundTruth } from '../helpers';

export function internalEdges(a: Analysis): Set<string> {
  const s = new Set<string>();
  for (const e of a.imports) if (e.to >= 0 && e.to !== e.from) s.add(`${a.files[e.from].path} -> ${a.files[e.to].path}`);
  return s;
}

function gtEdges(gt: any): string[] {
  const p = gt.importPrefix ?? '';
  return gt.imports.map(([f, t]: [string, string]) => `${p}${f} -> ${p}${t}`);
}

function hasCall(a: Analysis, fromFile: string, fromName: string, toFile: string, toName: string): boolean {
  const m = modelOf(a);
  return a.refs.some((r) => r.from >= 0 && m.path(a.symbols[r.from].file) === fromFile && a.symbols[r.from].name === fromName && m.path(a.symbols[r.to].file) === toFile && a.symbols[r.to].name === toName && r.kind === 'call');
}

describe('L2 (TypeScript compiler API)', () => {
  for (const name of ['nestjs-prisma', 'monorepo'] as const) {
    it(`${name}: import graph is exactly the ground truth, all edges resolved`, async () => {
      const gt = groundTruth(name);
      const { analysis: a } = await analyzeFixture(name);
      const found = [...internalEdges(a)].filter((e) => !e.includes('shims.d.ts')).sort();
      expect(found).toEqual(gtEdges(gt).sort());
      for (const e of a.imports) if (e.to >= 0) expect(e.conf).toBe('resolved');
      expect(a.coverage.l2Files).toBeGreaterThan(0);
    });
  }

  it('express-mongoose (CommonJS): every ground-truth import edge is found', async () => {
    const gt = groundTruth('express-mongoose');
    const { analysis: a } = await analyzeFixture('express-mongoose');
    const found = internalEdges(a);
    for (const e of gtEdges(gt)) expect(found, e).toContain(e);
    expect(found.size).toBe(gt.imports.length);
    const pkgs = new Set(a.imports.filter((e) => e.pkg).map((e) => e.pkg));
    for (const p of ['express', 'mongoose', 'axios', 'jsonwebtoken', 'node-cron']) expect(pkgs).toContain(p);
  });

  it('resolves type-aware calls through injected class members (NestJS)', async () => {
    const { analysis: a } = await analyzeFixture('nestjs-prisma');
    expect(hasCall(a, 'src/users/users.controller.ts', 'findOne', 'src/users/users.service.ts', 'findOne')).toBe(true);
    expect(hasCall(a, 'src/users/users.service.ts', 'findOne', 'src/posts/posts.service.ts', 'countByAuthor')).toBe(true);
    expect(hasCall(a, 'src/posts/posts.service.ts', 'create', 'src/users/users.service.ts', 'exists')).toBe(true);
    expect(hasCall(a, 'src/users/users.controller.ts', 'findAll', 'src/common/pagination.ts', 'toPage')).toBe(true);
    for (const r of a.refs) expect(r.conf).toBe('resolved');
  });

  it('resolves calls through CommonJS require + module.exports', async () => {
    const { analysis: a } = await analyzeFixture('express-mongoose');
    expect(hasCall(a, 'src/controllers/userController.js', 'get', 'src/services/userService.js', 'getUser')).toBe(true);
    expect(hasCall(a, 'src/services/orderService.js', 'placeOrder', 'src/services/paymentClient.js', 'charge')).toBe(true);
    expect(hasCall(a, 'src/services/userService.js', 'getUser', 'src/services/orderService.js', 'countOrdersForUser')).toBe(true);
    expect(hasCall(a, 'src/server.js', 'main', 'src/jobs/cleanup.js', 'startCleanupJob')).toBe(true);
    const m = modelOf(a);
    expect(m.findSymbol('src/controllers/orderController.js', 'create')).toBeGreaterThanOrEqual(0);
  });

  it('resolves calls across workspace packages and re-exports (monorepo)', async () => {
    const { analysis: a } = await analyzeFixture('monorepo');
    expect(hasCall(a, 'packages/api/src/services/invoiceService.ts', 'createInvoice', 'packages/shared/src/money.ts', 'formatMoney')).toBe(true);
    expect(hasCall(a, 'packages/web/src/components/InvoiceTotal.tsx', 'InvoiceTotal', 'packages/shared/src/money.ts', 'formatMoney')).toBe(true);
    expect(hasCall(a, 'packages/web/src/components/InvoiceList.tsx', 'InvoiceList', 'packages/web/src/components/InvoiceTotal.tsx', 'InvoiceTotal')).toBe(true);
    expect(hasCall(a, 'packages/api/src/routes/invoices.ts', 'createHandler', 'packages/api/src/services/invoiceService.ts', 'createInvoice')).toBe(true);
  });

  it('computes cyclomatic complexity and nesting', async () => {
    const { analysis: a } = await analyzeMem({
      'a.ts': 'export function f(x: number, y: number) {\n  if (x > 0 && y > 0) {\n    for (const i of [1]) {\n      if (i) return 1;\n    }\n  } else if (x < 0) {\n    return x ? 2 : 3;\n  }\n  return 0;\n}\n',
      'b.ts': "import { f } from './a';\nexport const g = () => f(1, 2);\n",
    });
    const f = a.symbols.find((s) => s.name === 'f')!;
    expect(f.complexity).toBe(7); // 1 + if + && + for + if + else-if + ?:
    expect(f.nesting).toBe(3);
    expect(f.params).toBe(2);
    expect(a.files.find((x) => x.path === 'a.ts')!.level).toBe(2);
  });

  it('honours tsconfig paths and records unresolvable relative imports', async () => {
    const { analysis: a } = await analyzeMem({
      'tsconfig.json': '{ "compilerOptions": { "baseUrl": ".", "paths": { "@lib/*": ["src/lib/*"] } } }',
      'src/lib/math.ts': 'export const add = (a: number, b: number) => a + b;\n',
      'src/main.ts': "import { add } from '@lib/math';\nimport { gone } from './missing';\nimport fs from 'node:fs';\nimport _ from 'lodash/fp';\nconsole.log(add(1, 2), gone, fs, _);\n",
    });
    expect([...internalEdges(a)]).toEqual(['src/main.ts -> src/lib/math.ts']);
    expect(a.unresolved.some((u) => u.file === 'src/main.ts' && u.line === 2 && u.kind === 'import')).toBe(true);
    expect(a.imports.filter((e) => e.pkg).map((e) => e.pkg).sort()).toEqual(['lodash', 'node:fs']);
  });
});
