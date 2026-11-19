// Scale benchmark on synthetic projects: time per pipeline phase and peak memory (Node).
// Opt-in: SCALE=1 [SCALE_SIZES=1000,10000] npm run bench:scale. Results go to tests/bench/scale.results.json,
// the numbers into docs/QUALITY.md. M12 extends the sizes (50k, 100k) and adds IndexedDB size.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
import { nodeEnv } from '../../src/core/node-env';
import { runPipeline } from '../../src/core/pipeline';
import { generateSynthetic } from '../../scripts/synthetic.mjs';

const OUT = join(fileURLToPath(new URL('.', import.meta.url)), 'scale.results.json');
const sizes = (process.env.SCALE_SIZES ?? '1000,10000').split(',').map(Number);

for (const n of sizes) {
  it.skipIf(!process.env.SCALE)(`${n} synthetic files`, async () => {
    const files = generateSynthetic(n);
    const peak = { rss: 0, heap: 0 };
    const sample = setInterval(() => {
      const m = process.memoryUsage();
      peak.rss = Math.max(peak.rss, m.rss);
      peak.heap = Math.max(peak.heap, m.heapUsed);
    }, 50);
    const t0 = Date.now();
    const { analysis: a } = await runPipeline({ kind: 'memory', files }, `synthetic-${n}`, {}, nodeEnv());
    clearInterval(sample);
    const row = {
      files: n,
      date: new Date().toISOString().slice(0, 10),
      totalMs: Date.now() - t0,
      timingsMs: a.timings,
      peakRssMB: Math.round(peak.rss / 1048576),
      peakHeapMB: Math.round(peak.heap / 1048576),
      imports: a.imports.length,
      symbols: a.symbols.length,
      entries: a.entries.length,
      notices: a.notices.length,
    };
    console.log(JSON.stringify(row));
    const prev: unknown[] = existsSync(OUT) ? JSON.parse(readFileSync(OUT, 'utf8')) : [];
    writeFileSync(OUT, JSON.stringify([...prev.filter((r) => (r as { files: number }).files !== n), row], null, 2) + '\n');
    expect(a.files.length).toBeGreaterThanOrEqual(n);
  });
}
