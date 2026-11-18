// U2: redesigned shell, sample project, keyboard navigation, graph controls, narrow layout, rename.
import { expect, test } from '@playwright/test';
import { analyzeFixture, openTab } from './util';

test('home: imex branding and the bundled sample project', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveTitle(/imex/);
  await expect(page.getByTestId('home-link')).toContainText('imex');
  await expect(page.getByTestId('privacy-pill')).toContainText('100% local');
  await page.getByTestId('sample-project').click();
  await expect(page.getByTestId('project-name')).toHaveText('sample-express-api');
  await expect(page.getByTestId('progress')).toHaveCount(0, { timeout: 90_000 });
  await openTab(page, 'flows');
  await expect(page.getByTestId('entry-list').getByRole('button')).toHaveCount(9);
});

test('theme: toggle persists under the new key and the pre-rename key is still honoured', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => { localStorage.clear(); localStorage.setItem('c-ray-theme', 'dark'); });
  await page.reload();
  await expect(page.locator('html')).toHaveClass(/dark/);
  await page.getByTestId('theme-toggle').click();
  await expect(page.locator('html')).not.toHaveClass(/dark/);
  expect(await page.evaluate(() => localStorage.getItem('imex-theme'))).toBe('light');
  // colours are tokens: the page background follows the theme
  const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  expect(bg).toBe('rgb(250, 249, 245)');
});

test('keyboard: "/" focuses the view filter (or opens Search); arrows move through flows and entities', async ({ page }) => {
  await analyzeFixture(page, 'express-mongoose');
  await openTab(page, 'health');
  await page.locator('body').press('/');
  await expect(page.locator('[data-search-focus]')).toBeFocused();

  await openTab(page, 'orientation');
  await page.locator('body').press('/');
  await expect(page.getByTestId('search-input')).toBeFocused();

  await openTab(page, 'flows');
  const first = await page.getByTestId('flow-title').textContent();
  await page.getByTestId('entry-list').getByRole('button').first().focus();
  await page.keyboard.press('ArrowDown');
  await expect(page.getByTestId('flow-title')).not.toHaveText(first!);
  await page.keyboard.press('ArrowUp');
  await expect(page.getByTestId('flow-title')).toHaveText(first!);

  await openTab(page, 'data');
  await page.getByTestId('entity-list').getByRole('button').first().click();
  await page.keyboard.press('ArrowDown');
  await expect(page.getByTestId('entity-detail')).toBeVisible();
  await expect(page.getByTestId('entity-list').locator('[aria-current="true"]')).toHaveCount(1);
});

test('system map: zoom controls, legend, minimap and focus mode', async ({ page }) => {
  await analyzeFixture(page, 'nestjs-prisma');
  await openTab(page, 'map');
  await expect(page.getByTestId('graph-legend')).toContainText('Resolved');
  await expect(page.getByTestId('graph-minimap')).toBeVisible();
  await page.waitForFunction(() => !!(window as unknown as { __cy?: unknown }).__cy);
  const zoom = () => page.evaluate(() => (window as unknown as { __cy: { zoom(): number } }).__cy.zoom());
  const z0 = await zoom();
  await page.getByTestId('graph-zoom-in').click();
  expect(await zoom()).toBeGreaterThan(z0);
  await page.getByTestId('graph-fit').click();

  // tapping a node focuses it: its neighbourhood stays lit, everything else fades
  const counts = await page.evaluate(() => {
    const cy = (window as unknown as { __cy: any }).__cy;
    const n = cy.getElementById('file:src/users/users.service.ts');
    n.emit('tap');
    return { faded: cy.elements('.faded').length, hot: cy.edges('.hot').length, focus: cy.nodes('.focus').length };
  });
  expect(counts.focus).toBe(1);
  expect(counts.hot).toBeGreaterThan(0);
  expect(counts.faded).toBeGreaterThan(0);
  await expect(page.getByTestId('map-details')).toContainText('src/users/users.service.ts');
});

test('narrow screens: the nav collapses to an icon rail and the source panel floats over the view', async ({ page }) => {
  await page.setViewportSize({ width: 820, height: 900 });
  await analyzeFixture(page, 'express-mongoose');
  const tab = page.getByTestId('tab-health');
  expect((await tab.boundingBox())!.width).toBeLessThan(60);
  await tab.click();
  await expect(tab).toHaveAttribute('aria-current', 'page');
  await page.locator('[data-ref]').first().click();
  const panel = page.getByTestId('source-panel');
  await expect(panel).toBeVisible();
  expect(await panel.evaluate((el) => getComputedStyle(el).position)).toBe('absolute');
});
