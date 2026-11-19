// U3: motion foundation and the new codebase visualisations, on fixtures with planted truth.
import { expect, test } from '@playwright/test';
import { zipSync } from 'fflate';
import { gitHistoryFiles } from '../git-fixture';
import { analyzeFixture, openTab, uploadZip } from './util';

async function gitHistoryZip(): Promise<Buffer> {
  const files: Record<string, Uint8Array> = {};
  for (const f of await gitHistoryFiles()) files[`git-history/${f.path}`] = f.bytes;
  return Buffer.from(zipSync(files));
}

test('reduced motion: nothing keeps animating and tabs still switch', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await analyzeFixture(page, 'express-mongoose');
  for (const tab of ['deps', 'health', 'orientation']) {
    await openTab(page, tab);
    await expect(page.getByTestId(`tab-${tab}`)).toHaveAttribute('aria-current', 'page');
  }
  await expect(page.getByTestId('treemap')).toBeVisible();
  const running = await page.evaluate(() => document.getAnimations().filter((a) => a.playState === 'running').length);
  expect(running).toBe(0);
  // counters show their final value immediately
  await expect(page.getByText('Files analysed').locator('..').locator('..')).toContainText(/\d/);
});

test('motion: nav highlight follows the tab; progress shows the pipeline steps', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('sample-project').click();
  // the stepper appears while analysing (it may finish quickly, so accept either state)
  await expect(page.getByTestId('progress-steps').or(page.getByTestId('project-name'))).toBeVisible();
  await expect(page.getByTestId('progress')).toHaveCount(0, { timeout: 90_000 });
  const pill = page.getByTestId('nav-pill');
  const before = await pill.evaluate((el) => el.style.transform);
  await openTab(page, 'health');
  await expect(pill).not.toHaveAttribute('style', new RegExp(before.replace(/[()]/g, '\\$&')));
  await expect(page.getByTestId('tab-health')).toHaveAttribute('aria-current', 'page');
});

test('orientation: treemap drill-down, breadcrumb, hover card, table fallback, breakdown', async ({ page }) => {
  await analyzeFixture(page, 'express-mongoose');
  const map = page.getByTestId('treemap');
  await expect(map).toBeVisible();
  await expect(page.getByTestId('lang-breakdown')).toContainText('JavaScript');
  await expect(page.getByTestId('role-breakdown')).toBeVisible();
  // drill into src/services
  const services = map.locator('[data-testid="treemap-cell"][data-path="src/services"]');
  await services.locator('rect').click({ position: { x: 20, y: 6 } });
  await expect(page.getByTestId('treemap-crumbs')).toContainText('services');
  await expect(map.locator('[data-kind="file"][data-path="src/services/userService.js"]')).toBeVisible();
  // hover card
  await map.locator('[data-path="src/services/userService.js"] rect').hover();
  await expect(page.getByTestId('treemap-tip')).toContainText('src/services/userService.js');
  await expect(page.getByTestId('treemap-tip')).toContainText('lines');
  // back up via the breadcrumb
  await page.getByTestId('treemap-crumbs').getByRole('button', { name: 'src' }).click();
  await expect(map.locator('[data-path="src/services"]')).toHaveCount(1);
  // double-click a file opens its source
  await map.locator('[data-path="src/services/userService.js"] rect').dblclick();
  await expect(page.getByTestId('source-panel')).toBeVisible();
  // colour modes and the table fallback
  await page.getByTestId('treemap-mode-complexity').click();
  await expect(page.getByTestId('treemap-legend')).toContainText('complexity');
  await page.getByTestId('treemap-switch').getByRole('button', { name: 'table' }).click();
  await expect(page.getByTestId('treemap-table')).toContainText('services/');
});

test('dependencies: matrix shows the cycle and the violation; a cell lists its imports', async ({ page }) => {
  await analyzeFixture(page, 'express-mongoose');
  await openTab(page, 'deps');
  const dsm = page.getByTestId('dsm');
  await expect(dsm).toBeVisible();
  await expect(dsm.locator('[data-cycle="true"]')).toHaveCount(2);
  await expect(dsm.locator('[data-violation="true"]')).not.toHaveCount(0);
  await dsm.locator('[data-cycle="true"]').first().click();
  const detail = page.getByTestId('dsm-detail');
  await expect(detail).toContainText('import loop');
  await expect(detail).toContainText('src/services/');
  await page.getByTestId('dsm-switch').getByRole('button', { name: 'table' }).click();
  await expect(page.getByTestId('dsm-table')).toContainText('cycle');
});

test('history: calendar tooltip, hotspot map point, snapshot play-through', async ({ page }) => {
  await page.goto('/');
  await uploadZip(page, 'git-history', await gitHistoryZip());
  await expect(page.getByTestId('project-name')).toHaveText('git-history');
  await expect(page.getByTestId('progress')).toHaveCount(0, { timeout: 90_000 });

  await openTab(page, 'history');
  const days = page.getByTestId('calendar-day');
  await expect(page.locator('[data-testid="calendar-day"]:not([data-count="0"])')).toHaveCount(12);
  await days.and(page.locator(':not([data-count="0"])')).first().hover();
  await expect(page.getByTestId('calendar-tip')).toContainText('1 commit on');
  await expect(page.getByTestId('author-strips').locator('[data-author]')).toHaveCount(3);

  // play through the snapshots: ends at HEAD with the billing module present
  await page.getByTestId('snap-play').click();
  await expect(page.getByTestId('snap-graph')).toHaveAttribute('data-snapshot', '9', { timeout: 20_000 });
  await expect(page.getByTestId('snap-graph').locator('[data-module="src/billing"]')).toHaveAttribute('data-present', 'yes');

  await openTab(page, 'health');
  const point = page.locator('[data-testid="hotspot-point"][data-file="src/services/pricing.ts"]');
  await expect(point).toHaveAttribute('data-risky', 'true');
  await expect(page.locator('[data-testid="hotspot-point"][data-file="src/services/tax.ts"]')).not.toHaveAttribute('data-risky', 'true');
  await point.click();
  await expect(page.getByTestId('hotspot-detail')).toContainText('src/services/pricing.ts');
});

test('flows: playback reaches the last step', async ({ page }) => {
  await analyzeFixture(page, 'express-mongoose');
  await openTab(page, 'flows');
  await page.getByTestId('entry-list').getByRole('button', { name: /POST \/api\/orders/ }).click();
  await page.getByTestId('flow-speed').selectOption('4');
  const steps = page.getByTestId('flow-steps').locator('li');
  const n = await steps.count();
  expect(n).toBeGreaterThan(2);
  await page.getByTestId('flow-play').click();
  await expect(steps.nth(n - 1)).toHaveAttribute('data-active', 'true', { timeout: 15_000 });
  await expect(page.getByTestId('flow-step-count')).toHaveText(`step ${n} of ${n}`);
  await page.getByTestId('flow-step-prev').click();
  await expect(steps.nth(n - 2)).toHaveAttribute('data-active', 'true');
});

test('impact: blast radius rings by distance, tests and entry points marked', async ({ page }) => {
  await analyzeFixture(page, 'express-mongoose');
  await openTab(page, 'impact');
  await page.getByTestId('impact-input').fill('src/config.js');
  await page.getByTestId('impact-suggestions').getByRole('button', { name: /src\/config\.js/ }).click();
  const blast = page.getByTestId('blast-radius');
  await expect(blast).toBeVisible();
  // config.js is imported directly by server.js, auth.js and paymentClient.js (fixture imports)
  await expect(blast.locator('[data-testid="blast-ring"][data-ring="1"]')).toHaveAttribute('data-count', '3');
  await expect(blast.locator('[data-testid="blast-dot"][data-file="src/server.js"]')).toHaveAttribute('data-entry', 'true');
  await blast.locator('[data-testid="blast-dot"][data-file="src/middleware/auth.js"]').click();
  await expect(page.getByTestId('source-panel')).toBeVisible();
});

test('data: interactive ER diagram focuses an entity and its relation', async ({ page }) => {
  await analyzeFixture(page, 'express-mongoose');
  await openTab(page, 'data');
  const er = page.getByTestId('er-interactive');
  await expect(er.locator('[data-testid="er-entity"]')).toHaveCount(2);
  await expect(er.locator('[data-testid="er-line"][data-from="Order"][data-to="User"]')).toHaveCount(1);
  await er.locator('[data-entity="Order"]').click();
  await expect(page.getByTestId('entity-detail')).toContainText('Order');
  await expect(er.locator('[data-entity="Order"]')).toHaveAttribute('aria-pressed', 'true');
});

test('system map: path finder, colour/size controls, locate from search, export', async ({ page }) => {
  await analyzeFixture(page, 'express-mongoose');
  await openTab(page, 'map');
  await expect(page.getByTestId('map-canvas')).toBeVisible();
  await page.getByTestId('map-color-by').selectOption('lang');
  await page.getByTestId('map-size-by').selectOption('fanin');
  await expect(page.getByTestId('graph-legend')).toContainText('javascript');

  await page.getByTestId('path-toggle').click();
  await page.getByTestId('path-from').fill('src/server.js');
  await page.getByTestId('path-to').fill('src/models/User.js');
  await page.getByTestId('path-find').click();
  await expect(page.getByTestId('path-result')).toContainText('5 steps');
  await expect(page.getByTestId('path-step')).toHaveText('1 / 5');
  await page.getByTestId('path-next').click();
  await expect(page.getByTestId('path-result')).toContainText('src/routes/users.js');
  await expect.poll(() => page.evaluate(() => (window as unknown as { __cy: { $: (s: string) => { length: number } } }).__cy.$('.on-path').length)).toBeGreaterThan(5);

  // export the view
  await page.getByTestId('graph-export').click();
  const [png] = await Promise.all([page.waitForEvent('download'), page.getByTestId('export-png').click()]);
  expect(png.suggestedFilename()).toBe('express-mongoose-system-map.png');
  await page.getByTestId('graph-export').click();
  const [svg] = await Promise.all([page.waitForEvent('download'), page.getByTestId('export-svg').click()]);
  expect(svg.suggestedFilename()).toBe('express-mongoose-system-map.svg');

  // locate a search result on the map
  await openTab(page, 'search');
  await page.getByTestId('search-input').fill('placeOrder');
  await page.getByTestId('locate-on-map').first().click();
  await expect(page.getByTestId('tab-map')).toHaveAttribute('aria-current', 'page');
  await expect(page.getByTestId('locate-pulse')).toHaveCount(1);
});

// ── U4 slice 3 (the old U3 slice 4): hero picture, empty-state art, logo ──

test('home hero: the graph assembles on wide screens, is static under reduced motion, hidden on phones', async ({ page }) => {
  await page.goto('/');
  const hero = page.getByTestId('hero-graph');
  await expect(hero).toBeVisible();
  await expect(hero.locator('circle.assemble')).toHaveCount(9);
  // it settles: after a few seconds nothing on Home is still animating (no idle looping, D36)
  await expect.poll(() => page.evaluate(() => document.getAnimations().filter((a) => a.playState === 'running').length), { timeout: 8000 }).toBe(0);
  await page.setViewportSize({ width: 600, height: 900 });
  await expect(hero).toBeHidden();

  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.reload();
  await expect(page.getByTestId('hero-graph')).toBeVisible();
  expect(await page.evaluate(() => document.getAnimations().filter((a) => a.playState === 'running').length)).toBe(0);
  // the finished picture is shown: every node is fully opaque
  const opaque = await page.getByTestId('hero-graph').locator('circle').evaluateAll((els) => els.every((e) => getComputedStyle(e).opacity === '1'));
  expect(opaque).toBe(true);
});

test('empty states carry an illustration (History without .git)', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('sample-project').click();
  await expect(page.getByTestId('progress')).toHaveCount(0, { timeout: 90_000 });
  await openTab(page, 'history');
  const art = page.getByTestId('history-empty').getByTestId('empty-art');
  await expect(art).toHaveAttribute('data-art', 'history');
  await expect(art).toHaveAttribute('aria-hidden', 'true');
  await expect(page.getByTestId('history-empty')).toContainText('No git history');
});

test('logo: the arrows swap on hover, and keep swapping while an analysis runs', async ({ page }) => {
  await page.goto('/');
  const arrow = page.getByTestId('home-link').locator('.logo-a');
  const at = () => arrow.evaluate((e) => getComputedStyle(e).transform);
  expect(await at()).toBe('none');
  await page.getByTestId('home-link').hover();
  await expect.poll(at).not.toBe('none');
  await page.mouse.move(700, 500);
  await expect.poll(at).toBe('none');
  await page.getByTestId('sample-project').click();
  await expect(page.locator('[data-testid="logo-mark"][data-busy]')).toBeVisible();
  await expect(page.getByTestId('progress')).toHaveCount(0, { timeout: 90_000 });
  await expect(page.locator('[data-testid="logo-mark"][data-busy]')).toHaveCount(0);
});
