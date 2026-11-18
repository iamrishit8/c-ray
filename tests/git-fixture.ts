// Builds the `git-history` fixture: a small TS project with a planted commit history
// (authors, a co-changing pair with no import between them, a single-owner file, an
// annotated tag, a module added late). Built with isomorphic-git at test time because a
// nested .git folder cannot be committed. Planted facts: tests/fixtures/git-history/ground-truth.json.
import fs from 'node:fs';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import git from 'isomorphic-git';
import { readDir } from './helpers';

export const ALICE = { name: 'Alice', email: 'alice@example.com' };
const BOB = { name: 'Bob', email: 'bob@example.com' };
const CAROL = { name: 'Carol', email: 'carol@example.com' };
/** 2026-01-05T00:00:00Z; commit n is made n days later. */
const T0 = Date.UTC(2026, 0, 5) / 1000;
const DAY = 86_400;

const pricing = (version: number) => `// Price calculation for orders.
export interface Line { sku: string; qty: number; price: number; exempt?: boolean }

export function lineTotal(line: Line, tier: string): number {
  let total = line.qty * line.price;
  if (tier === 'gold') total *= 0.8;
  else if (tier === 'silver') total *= 0.9;
  else if (tier === 'bronze') total *= 0.95;
  if (line.qty > 100) total -= 5;
  if (line.qty > 1000 && tier !== 'none') total -= 50;
  if (total < 0) total = 0;${version >= 2 ? '\n  total = Math.round(total * 100) / 100;' : ''}${version >= 3 ? "\n  if (line.sku.startsWith('PROMO') || line.sku.startsWith('SALE')) total *= 0.5;" : ''}${version >= 4 ? '\n  if (line.exempt) return total;' : ''}
  return total;
}

export function orderTotal(lines: Line[], tier: string): number {
  let sum = 0;
  for (const l of lines) sum += lineTotal(l, tier);
  return sum;
}
`;

const tax = (version: number) => `// Tax rates by region (kept in step with pricing.ts by convention, not by import).
export function taxRate(region: string): number {
  return region === 'EU' ? 0.2 : ${version >= 2 ? '0.0725' : '0.07'};
}
${version >= 3 ? 'export const DISCOUNT_TAXABLE = true;\n' : ''}${version >= 4 ? 'export const EXEMPT_CODES = ["NGO", "GOV"];\n' : ''}`;

const report = (version: number) => `// Legacy monthly sales report (only Carol knows how this works).
export function salesReport(rows: { amount: number; region: string; refunded: boolean }[]): string {
  let eu = 0;
  let us = 0;
  for (const r of rows) {
    if (r.refunded) continue;
    if (r.region === 'EU') eu += r.amount;
    else if (r.region === 'US') us += r.amount;${version >= 2 ? '\n    // refunds are excluded above' : ''}
  }${version >= 3 ? '\n  if (eu < 0 || us < 0) return "invalid";' : ''}
  return ${version >= 4 ? '`EU=${eu.toFixed(2)};US=${us.toFixed(2)}`' : '`EU=${eu} US=${us}`'};
}
`;

const server = (version: number) => `// HTTP entry point.
import { listOrders } from './routes/orders';
${version >= 2 ? "import { invoice } from './billing/invoice';\n" : ''}
export function start(): void {
  console.log(listOrders());${version >= 2 ? '\n  console.log(invoice([]));' : ''}
}
`;

const ORDERS = `// Order routes.
import { orderTotal } from '../services/pricing';

export function listOrders(): number {
  return orderTotal([], 'none');
}
`;

const INVOICE = `// Invoices (added after v1.0).
import { orderTotal, type Line } from '../services/pricing';

export function invoice(lines: Line[]): string {
  return 'Total: ' + orderTotal(lines, 'none');
}
`;

const TEST = `// Pricing edge cases.
import { lineTotal } from '../src/services/pricing';

export function testZero(): boolean {
  return lineTotal({ sku: 'A', qty: 0, price: 1 }, 'none') === 0;
}
`;

const pkg = (version: string) => JSON.stringify({ name: 'git-history', version: '1.0.0', dependencies: { express: version } }, null, 2) + '\n';

export interface Step {
  who: typeof ALICE;
  msg: string;
  /** New content per path; `null` deletes the file. */
  files: Record<string, string | null>;
  tag?: string;
}

/** The planted history, oldest first. Keep in sync with ground-truth.json (written by hand). */
const HISTORY: Step[] = [
  { who: ALICE, msg: 'initial commit', files: { 'package.json': pkg('^4.18.0'), 'README.md': '# Shop\n', 'src/server.ts': server(1), 'src/routes/orders.ts': ORDERS, 'src/services/pricing.ts': pricing(1), 'src/services/tax.ts': tax(1) } },
  { who: CAROL, msg: 'feat(report): add legacy sales report', files: { 'src/legacy/report.ts': report(1) } },
  { who: BOB, msg: 'fix: rounding in pricing and tax', files: { 'src/services/pricing.ts': pricing(2), 'src/services/tax.ts': tax(2) } },
  { who: CAROL, msg: 'Refactor report totals', files: { 'src/legacy/report.ts': report(2) } },
  { who: ALICE, msg: 'feat: discount tiers in pricing', files: { 'src/services/pricing.ts': pricing(3), 'src/services/tax.ts': tax(3) } },
  { who: ALICE, msg: 'docs: explain pricing rules', files: { 'README.md': '# Shop\n\nPrices: see src/services/pricing.ts.\n' } },
  { who: CAROL, msg: 'Fix crash in legacy report', files: { 'src/legacy/report.ts': report(3) }, tag: 'v1.0' },
  { who: BOB, msg: 'test: pricing edge cases', files: { 'tests/pricing.test.ts': TEST } },
  { who: ALICE, msg: 'feat(billing): invoice module', files: { 'src/billing/invoice.ts': INVOICE, 'src/server.ts': server(2) } },
  { who: BOB, msg: 'fix(pricing): tax-exempt customers', files: { 'src/services/pricing.ts': pricing(4), 'src/services/tax.ts': tax(4) } },
  { who: CAROL, msg: 'Update legacy report output', files: { 'src/legacy/report.ts': report(4) } },
  { who: ALICE, msg: 'chore: bump dependencies', files: { 'package.json': pkg('^4.21.0') } },
];

// ---------- git-moves: renames and a package that imports itself (tests/fixtures/git-moves) ----------

/** lib/main.js → a → b → c → d → e: the test reaches e.js through its own package name (resolved via
 *  `exports`, a path no default candidate covers) in 6 hops. */
const chain = (name: string, next: string | null, v = 1) => `// Step ${name} of the pipeline.
${next ? `const next = require('./${next}');\n` : ''}module.exports = function ${name}(x) {
  return ${next ? 'next(x + 1)' : `x * ${v}`};
};
`;
const E_TEST = (v: number) => `// End-to-end check through the public entry.
const lib = require('acme-lib');
module.exports = () => lib(1) === ${v * 6};
`;
const util = (v: number) => `// String helpers (edited in step with legacy.js, no import between them).
module.exports.pad = (s) => String(s).padStart(${v + 1}, ' ');
`;
const legacy = (v: number) => `// Legacy formatter.
module.exports.fmt = (s) => String(s).padEnd(${v + 1}, ' ');
`;
const helpers = (v: number) => `// Shared helpers.
module.exports.clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
module.exports.sum = (xs) => xs.reduce((s, x) => s + x, 0);
module.exports.mean = (xs) => module.exports.sum(xs) / xs.length;
module.exports.version = ${v};
`;
const FORMAT = (moved: boolean) => `// Number formatting.
function money(n) { return n.toFixed(2); }
function percent(n) { return Math.round(n * 100) + '%'; }
function compact(n) { return n > 1000 ? Math.round(n / 1000) + 'k' : String(n); }
function signed(n) { return (n > 0 ? '+' : '') + n; }
module.exports = { money, percent, compact, signed${moved ? ', VERSION: 2' : ''} };
`;
const LIB_PKG = JSON.stringify({ name: 'acme-lib', version: '1.0.0', exports: { '.': { require: './lib/main.js' } } }, null, 2) + '\n';

const MOVES: Step[] = [
  { who: ALICE, msg: 'initial commit', files: { 'package.json': LIB_PKG, 'lib/main.js': chain('main', 'a'), 'lib/a.js': chain('a', 'b'), 'lib/b.js': chain('b', 'c'), 'lib/c.js': chain('c', 'd'), 'lib/d.js': chain('d', 'e'), 'lib/e.js': chain('e', null, 1), 'lib/old-name.js': helpers(1), 'lib/fmt.js': FORMAT(false), 'lib/util.js': util(1), 'lib/legacy.js': legacy(1) } },
  { who: BOB, msg: 'test: end-to-end check', files: { 'test/e.test.js': E_TEST(1) } },
  { who: CAROL, msg: 'fix: helpers v2', files: { 'lib/old-name.js': helpers(2) } },
  { who: BOB, msg: 'feat: scale e by 2', files: { 'lib/e.js': chain('e', null, 2), 'test/e.test.js': E_TEST(2) } },
  { who: CAROL, msg: 'fix: helpers v3', files: { 'lib/old-name.js': helpers(3) } },
  { who: ALICE, msg: 'fix: padding', files: { 'lib/util.js': util(2), 'lib/legacy.js': legacy(2) } },
  { who: BOB, msg: 'refactor: rename old-name.js to helpers.js', files: { 'lib/old-name.js': null, 'lib/helpers.js': helpers(3) } },
  { who: CAROL, msg: 'fix: helpers v4', files: { 'lib/helpers.js': helpers(4) } },
  { who: BOB, msg: 'feat: scale e by 3', files: { 'lib/e.js': chain('e', null, 3), 'test/e.test.js': E_TEST(3) } },
  { who: ALICE, msg: 'refactor: move fmt.js to format/index.js', files: { 'lib/fmt.js': null, 'lib/format/index.js': FORMAT(true) } },
  { who: ALICE, msg: 'fix: padding again', files: { 'lib/util.js': util(3), 'lib/legacy.js': legacy(3) } },
];

let moves: { path: string; bytes: Uint8Array }[] | null = null;
export async function gitMovesFiles(): Promise<{ path: string; bytes: Uint8Array }[]> {
  moves ??= await buildRepo(MOVES);
  return moves;
}

let built: { path: string; bytes: Uint8Array }[] | null = null;

/** Working tree + `.git/` of the fixture repo, as in-memory files (cached per process). */
export async function gitHistoryFiles(): Promise<{ path: string; bytes: Uint8Array }[]> {
  built ??= await buildRepo(HISTORY);
  return built;
}

/** Build a repository from a list of commits (oldest first) and return its working tree + `.git/`. */
export async function buildRepo(history: Step[]): Promise<{ path: string; bytes: Uint8Array }[]> {
  const dir = mkdtempSync(join(tmpdir(), 'imex-git-'));
  try {
    await git.init({ fs, dir, defaultBranch: 'main' });
    for (let i = 0; i < history.length; i++) {
      const step = history[i];
      for (const [path, text] of Object.entries(step.files)) {
        if (text === null) {
          rmSync(join(dir, path));
          await git.remove({ fs, dir, filepath: path });
          continue;
        }
        mkdirSync(dirname(join(dir, path)), { recursive: true });
        writeFileSync(join(dir, path), text);
        await git.add({ fs, dir, filepath: path });
      }
      const sig = { ...step.who, timestamp: T0 + i * DAY, timezoneOffset: 0 };
      await git.commit({ fs, dir, message: step.msg, author: sig, committer: sig });
      if (step.tag) await git.annotatedTag({ fs, dir, ref: step.tag, message: `Release ${step.tag}`, tagger: sig });
    }
    return readDir(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
