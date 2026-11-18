import { expect, test } from '@playwright/test';
import { analyzeFixture, openTab } from './util';

test('system map renders clusters, filters by confidence, shows details', async ({ page }) => {
  await analyzeFixture(page, 'nestjs-prisma');
  await openTab(page, 'map');
  await expect(page.getByTestId('map-counts')).toContainText('nodes');
  await page.waitForFunction(() => (window as any).__cy?.nodes().length > 5);
  const counts = await page.evaluate(() => ({ nodes: (window as any).__cy.nodes().length, edges: (window as any).__cy.edges().length }));
  expect(counts.nodes).toBeLessThanOrEqual(500);
  expect(counts.edges).toBeGreaterThan(10);

  // details panel: select a file node
  await page.evaluate(() => (window as any).__cy.$id('file:src/users/users.service.ts').emit('tap'));
  await expect(page.getByTestId('map-details')).toContainText('src/users/users.service.ts');
  await expect(page.getByTestId('map-deps')).toContainText('src/prisma/prisma.service.ts');
  await expect(page.getByTestId('map-dependents')).toContainText('src/users/users.controller.ts');
  await expect(page.getByTestId('map-preview')).toContainText('@Injectable()');

  // all edges are L2-resolved in this fixture, so hiding "resolved" removes every edge
  await expect(page.getByTestId('conf-resolved')).toHaveAttribute('aria-pressed', 'true');
  await page.getByTestId('conf-resolved').click();
  await expect(page.getByTestId('conf-resolved')).toHaveAttribute('aria-pressed', 'false');
  await expect(page.getByTestId('map-counts')).toContainText(' 0 edges');
});

test('search: symbol → definition → references; full text', async ({ page }) => {
  await analyzeFixture(page, 'monorepo');
  await openTab(page, 'search');
  await page.getByTestId('search-input').fill('formatMoney');
  await expect(page.getByTestId('symbol-results')).toContainText('formatMoney');
  await page.getByTestId('symbol-results').getByRole('button', { name: 'formatMoney' }).first().click();
  await expect(page.getByTestId('source-panel')).toContainText('export function formatMoney');
  await page.getByTestId('find-refs').first().click();
  await expect(page.getByTestId('references')).toContainText('packages/api/src/services/invoiceService.ts');
  await expect(page.getByTestId('references')).toContainText('resolved');

  await page.getByTestId('search-input').fill('currency mismatch');
  await expect(page.getByTestId('text-results')).toContainText('packages/shared/src/money.ts');
});

test('single file → File Mode with functions and explanation', async ({ page }) => {
  await page.goto('/');
  const code = 'export function a(x: number) {\n  if (x > 1) return b(x);\n  return 0;\n}\nfunction b(y: number) {\n  return y * 2;\n}\n';
  await page.getByTestId('file-input').setInputFiles({ name: 'solo.ts', mimeType: 'text/plain', buffer: Buffer.from(code) });
  await expect(page.getByTestId('project-name')).toHaveText('solo.ts');
  await expect(page.getByTestId('file-mode-note')).toContainText('need more than one file');
  await expect(page.getByTestId('tab-map')).toHaveCount(0);
  await openTab(page, 'symbols');
  await expect(page.getByTestId('file-explanation')).toContainText('2 function');
  await expect(page.getByTestId('functions')).toContainText('a');
  await expect(page.getByTestId('call-graph')).toBeVisible();
});
