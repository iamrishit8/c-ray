// U3/U4: frame times while panning, zooming and focusing the system map and while the treemap drills, on a synthetic
// project (default 10 000 files). Opt-in because it takes minutes: PERF=1 [PERF_FILES=10000] npx playwright test u3-perf
// Results go to tests/bench/u3-frames.results.json and the numbers into docs/QUALITY.md.
// Headless Chromium paints in software, so these are pessimistic compared with a machine with a GPU.
import { test, expect, type Page } from '@playwright/test';
import { zipSync, strToU8 } from 'fflate';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateSynthetic } from '../../scripts/synthetic.mjs';

const N = Number(process.env.PERF_FILES ?? 10_000);
const OUT = join(fileURLToPath(new URL('.', import.meta.url)), '../bench/u3-frames.results.json');

interface Frames { frames: number; medianMs: number; p95Ms: number; maxMs: number; over50: number; over100: number }
type Repeated = Frames & { runsMaxMs: number[] };
const REPEATS = 3;

async function startSampling(page: Page) {
  await page.evaluate(() => {
    const w = window as unknown as { __frames: number[]; __raf: number };
    w.__frames = [];
    let last = performance.now();
    const tick = (t: number) => {
      w.__frames.push(t - last);
      last = t;
      w.__raf = requestAnimationFrame(tick);
    };
    w.__raf = requestAnimationFrame(tick);
  });
}
async function stopSampling(page: Page): Promise<Frames> {
  return page.evaluate(() => {
    const w = window as unknown as { __frames: number[]; __raf: number };
    cancelAnimationFrame(w.__raf);
    const f = w.__frames.slice(1).sort((a, b) => a - b);
    const q = (p: number) => f[Math.min(f.length - 1, Math.floor(p * f.length))] ?? 0;
    const r = (x: number) => Math.round(x * 10) / 10;
    return { frames: f.length, medianMs: r(q(0.5)), p95Ms: r(q(0.95)), maxMs: r(f[f.length - 1] ?? 0), over50: f.filter((x) => x > 50).length, over100: f.filter((x) => x > 100).length };
  });
}
async function measure(page: Page, action: () => Promise<void>): Promise<Frames> {
  await startSampling(page);
  await action();
  await page.waitForTimeout(150);
  return stopSampling(page);
}

/** Runs an interaction REPEATS times (this machine is shared and frame times are noisy) and keeps the median run by its worst frame. */
async function measureN(page: Page, action: () => Promise<void>): Promise<Repeated> {
  const runs: Frames[] = [];
  for (let i = 0; i < REPEATS; i++) runs.push(await measure(page, action));
  const sorted = [...runs].sort((a, b) => a.maxMs - b.maxMs);
  return { ...sorted[Math.floor(sorted.length / 2)], runsMaxMs: runs.map((r) => r.maxMs) };
}

test.skip(!process.env.PERF, 'opt-in: PERF=1');

test(`frame times on ${N} synthetic files`, async ({ page }) => {
  test.setTimeout(15 * 60_000);
  const zip = Buffer.from(zipSync(Object.fromEntries(generateSynthetic(N).map((f) => [`synthetic-${N}/${f.path}`, strToU8(f.text)])), { level: 1 }));
  await page.goto('/');
  const t0 = Date.now();
  await page.getByTestId('file-input').setInputFiles({ name: `synthetic-${N}.zip`, mimeType: 'application/zip', buffer: zip });
  await expect(page.getByTestId('project-name')).toHaveText(`synthetic-${N}`, { timeout: 120_000 });
  await expect(page.getByTestId('progress')).toHaveCount(0, { timeout: 10 * 60_000 });
  const analysisSeconds = Math.round((Date.now() - t0) / 100) / 10;

  // ── system map: pan, zoom, focus ──
  await page.getByTestId('tab-map').click();
  const canvas = page.getByTestId('map-canvas');
  await expect(canvas).toBeVisible();
  await expect(page.getByTestId('map-counts')).toContainText('nodes');
  await page.getByRole('button', { name: 'Expand all' }).click(); // as many nodes as the 500-node budget allows
  await page.waitForTimeout(4000); // layout settles
  const counts = (await page.getByTestId('map-counts').innerText()).trim();
  const box = (await canvas.boundingBox())!;
  const pan = await measureN(page, async () => {
    await page.mouse.move(box.x + 12, box.y + 12);
    await page.mouse.down();
    for (let i = 1; i <= 80; i++) await page.mouse.move(box.x + 12 + i * 5, box.y + 12 + i * 3);
    for (let i = 80; i >= 0; i--) await page.mouse.move(box.x + 12 + i * 5, box.y + 12 + i * 3); // and back
    await page.mouse.up();
  });
  const zoom = await measureN(page, async () => {
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    for (let i = 0; i < 12; i++) {
      await page.mouse.wheel(0, i < 6 ? -240 : 240);
      await page.waitForTimeout(30);
    }
  });
  await page.getByTestId('graph-fit').click();
  const focus = await measureN(page, async () => {
    // tap the middle of the canvas a few times; any node hit focuses its neighbourhood, a miss clears it
    for (const [fx, fy] of [[0.5, 0.5], [0.4, 0.45], [0.6, 0.55], [0.5, 0.35]]) {
      await page.mouse.click(box.x + box.width * fx, box.y + box.height * fy);
      await page.waitForTimeout(200);
    }
  });

  // ── treemap: drill down and back ──
  await page.getByTestId('tab-orientation').click();
  const map = page.getByTestId('treemap');
  await expect(map).toBeVisible();
  const cells = await map.locator('[data-testid="treemap-cell"]').count();
  const drill = await measureN(page, async () => {
    for (let d = 0; d < 3; d++) {
      const dir = map.locator('[data-testid="treemap-cell"][data-kind="dir"]').first();
      if ((await dir.count()) === 0) break;
      // a folder's middle is covered by its own file cells; its padded edge is what drills in
      await dir.click({ position: { x: 3, y: 3 }, force: true });
      await page.waitForTimeout(450);
    }
    await page.getByTestId('treemap-crumbs').getByRole('button').first().click();
    await page.waitForTimeout(450);
  });
  const cellsAfterDrill = await map.locator('[data-testid="treemap-cell"]').count();

  const row = { files: N, date: new Date().toISOString().slice(0, 10), analysisSeconds, map: counts, mapPan: pan, mapZoom: zoom, mapFocus: focus, treemapCells: cells, treemapCellsAfterReturn: cellsAfterDrill, treemapDrill: drill, browser: 'headless Chromium, software paint' };
  console.log(JSON.stringify(row, null, 2));
  const prev: { files: number }[] = existsSync(OUT) ? JSON.parse(readFileSync(OUT, 'utf8')) : [];
  writeFileSync(OUT, JSON.stringify([...prev.filter((r) => r.files !== N), row], null, 2) + '\n');
  expect(pan.frames).toBeGreaterThan(5);
});
